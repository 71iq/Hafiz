import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(path.join(process.cwd(), "supabase/functions/qf-content/index.ts"), "utf8");
const script = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

type Handler = (request: Request) => Promise<Response>;

/** Runs the Edge Function with an upstream that never answers until its request is aborted. */
function startFunction(upstream: (url: string) => Promise<Response> | "stall") {
  let handler: Handler | null = null;
  const timeouts: number[] = [];
  const requested: string[] = [];
  const settings: Record<string, string> = {
    QF_CONTENT_CLIENT_ID: "synthetic-client",
    QF_CONTENT_CLIENT_SECRET: "synthetic-secret",
    QF_CONTENT_ENV: "prelive",
  };
  const context = {
    Deno: { serve: (next: Handler) => void (handler = next), env: { get: (name: string) => settings[name] } },
    // The function asks for ten seconds; the test lets that deadline pass after twenty milliseconds.
    AbortSignal: {
      timeout: (ms: number) => {
        timeouts.push(ms);
        return AbortSignal.timeout(20);
      },
    },
    fetch: (url: string, init: { signal?: AbortSignal }) => {
      requested.push(url);
      const answer = upstream(url);
      if (answer !== "stall") return answer;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    },
    Response,
    URLSearchParams,
    btoa,
    console: { warn: () => {} },
    Date,
    JSON,
    Number,
    Promise,
    Error,
    encodeURIComponent,
  };
  vm.runInNewContext(script, context);
  const call = async (body: unknown) => {
    const response = await handler!({ method: "POST", json: async () => body } as unknown as Request);
    return { status: response.status, body: await response.json() };
  };
  return { call, timeouts, requested };
}

const token = () => Promise.resolve(Response.json({ access_token: "synthetic-token", expires_in: 3600 }));

describe("qf-content gives up on a stalled Quran Foundation request", () => {
  it("answers with an upstream error when the token request never completes", async () => {
    const fn = startFunction(() => "stall");

    const reply = await fn.call({ action: "audio-reciter-lookup", language: "en" });

    expect(reply).toEqual({
      status: 502,
      body: { ok: false, code: "upstream", message: "Quran Foundation content is temporarily unavailable." },
    });
    expect(fn.timeouts).toEqual([10_000]);
  });

  it("answers with an upstream error when the content request never completes, then serves the next request", async () => {
    let stalled = true;
    const fn = startFunction((url) => {
      if (url.includes("/oauth2/token")) return token();
      if (stalled) return "stall";
      return Promise.resolve(
        Response.json({ audio_files: [{ verse_key: "2:255", url: "Alafasy/mp3/002255.mp3", format: "mp3" }] }),
      );
    });

    const first = await fn.call({ action: "audio-ayah", surah: 2, ayah: 255 });
    expect(first.status).toBe(502);

    stalled = false;
    const second = await fn.call({ action: "audio-ayah", surah: 2, ayah: 255 });
    expect(second.status).toBe(200);
    expect(second.body.audio.url).toBe("https://verses.quran.foundation/Alafasy/mp3/002255.mp3");
    // Every Quran Foundation request carries the deadline: token, stalled content, content.
    expect(fn.timeouts).toEqual([10_000, 10_000, 10_000]);
    expect(fn.requested).toHaveLength(3);
  });
});
