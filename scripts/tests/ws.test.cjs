const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const { createRequire } = require("node:module");
const { test } = require("node:test");

const root = process.cwd();
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const versions = {
  "node_modules/ws": "7.5.13",
  "node_modules/@supabase/realtime-js/node_modules/ws": "8.21.1",
  "node_modules/jsdom/node_modules/ws": "8.21.1",
  "node_modules/expo/node_modules/ws": "8.22.1",
};
const copies = Object.entries(lock.packages).filter(
  ([name]) => name === "node_modules/ws" || name.endsWith("/node_modules/ws"),
);
assert.deepEqual(copies.map(([name]) => name).sort(), Object.keys(versions).sort());

function frame(opcode, final, value = "") {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
  assert.ok(data.length < 126);
  return Buffer.concat([Buffer.from([(final ? 128 : 0) | opcode, data.length]), data]);
}

async function receive(Receiver, major, chunks, maxFragments, maxBufferedChunks) {
  const receiver =
    major === 7
      ? new Receiver("nodebuffer", {}, false, 32, maxBufferedChunks, maxFragments)
      : new Receiver({
          binaryType: "nodebuffer",
          extensions: {},
          isServer: false,
          maxPayload: 32,
          maxFragments,
          maxBufferedChunks,
          allowSynchronousEvents: true,
        });
  const messages = [];
  const errors = [];
  receiver.on("message", (data, binary) =>
    messages.push({ data: Buffer.from(data), binary, rawBuffer: Buffer.isBuffer(data) }),
  );
  receiver.on("error", (error) => errors.push(error));
  let failure;
  try {
    for (const chunk of chunks) {
      const error = await new Promise((resolve) => receiver.write(chunk, (value) => resolve(value)));
      if (error) {
        failure = error;
        break;
      }
    }
    await new Promise((resolve) => setImmediate(resolve));
    return { messages, error: failure || errors[0] };
  } finally {
    receiver.destroy();
  }
}

function assertLimit(error, message) {
  assert.ok(error instanceof RangeError, "Receiver must reject the bounded over-limit fixture");
  assert.equal(error.code, "WS_ERR_TOO_MANY_BUFFERED_PARTS");
  assert.equal(error.message, message);
}

function bounded(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timed out: " + label)), 2000);
    }),
  ]).finally(() => clearTimeout(timer));
}

function send(socket, value, final, compressed) {
  return new Promise((resolve, reject) => {
    socket.send(value, { fin: final, compress: compressed }, (error) => (error ? reject(error) : resolve()));
  });
}

async function transport(t, WebSocket, receivingSide, compressed) {
  const server = http.createServer((_, response) => {
    response.writeHead(404);
    response.end();
  });
  const sockets = new Set();
  const wss = new WebSocket.Server({
    noServer: true,
    maxFragments: receivingSide === "server" ? 2 : 0,
    maxBufferedChunks: receivingSide === "server" ? 16 : 0,
    perMessageDeflate: compressed ? { threshold: 0 } : false,
  });
  let client;
  server.on("upgrade", (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (websocket) => wss.emit("connection", websocket, request));
  });
  wss.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
  });
  t.after(async () => {
    client?.terminate();
    for (const socket of sockets) socket.terminate();
    await new Promise((resolve) => wss.close(resolve));
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const accepted = once(wss, "connection");
  client = new WebSocket("ws://127.0.0.1:" + server.address().port, {
    maxFragments: receivingSide === "client" ? 2 : 0,
    maxBufferedChunks: receivingSide === "client" ? 16 : 0,
    perMessageDeflate: compressed ? { threshold: 0 } : false,
  });
  client.on("error", () => {});
  await bounded(once(client, "open"), "local connection");
  const [serverSocket] = await bounded(accepted, "local upgrade");
  const receiver = receivingSide === "server" ? serverSocket : client;
  const sender = receivingSide === "server" ? client : serverSocket;
  assert.equal(receiver.extensions.includes("permessage-deflate"), compressed);
  assert.equal(receiver._receiver._maxBufferedChunks, 16, "Public options must reach the actual connection Receiver");
  let decompressions = 0;
  if (compressed) {
    const extension = receiver._extensions["permessage-deflate"];
    const original = extension.decompress;
    extension.decompress = function (...args) {
      decompressions += 1;
      return original.apply(this, args);
    };
    t.after(() => {
      extension.decompress = original;
    });
  }
  const messages = [];
  let phase = "valid";
  let validResolve;
  let validReject;
  const valid = bounded(
    new Promise((resolve, reject) => {
      validResolve = resolve;
      validReject = reject;
    }),
    "valid messages",
  );
  let outcomeResolve;
  const outcome = new Promise((resolve) => {
    outcomeResolve = resolve;
  });
  receiver.on("message", (data) => {
    messages.push(data.toString());
    if (phase === "valid" && messages.length === 2) validResolve();
    if (phase === "invalid") outcomeResolve({ kind: "message" });
  });
  receiver.on("error", (error) => {
    if (phase === "valid") validReject(error);
    else outcomeResolve({ kind: "error", error });
  });
  await send(sender, "a", false, compressed);
  await send(sender, "b", true, compressed);
  await send(sender, "c", false, compressed);
  await send(sender, "d", true, compressed);
  await valid;
  assert.deepEqual(messages, ["ab", "cd"]);
  assert.equal(decompressions, compressed ? 4 : 0, "Compression cases must exercise actual decompression");
  phase = "invalid";
  const closed = once(sender, "close");
  await send(sender, "", false, compressed);
  await send(sender, "", false, compressed);
  await send(sender, "", true, compressed);
  const result = await bounded(outcome, "fragment rejection");
  assert.equal(result.kind, "error", "Empty frames must count before a third message is delivered");
  assertLimit(result.error, "Too many message fragments");
  const [code] = await bounded(closed, "policy close");
  assert.equal(code, 1008);
  assert.deepEqual(messages, ["ab", "cd"]);
}

for (const [name, metadata] of copies) {
  const directory = path.join(root, name);
  const WebSocket = require(directory);
  const Receiver = require(path.join(directory, "lib/receiver.js"));
  const major = Number(metadata.version.split(".")[0]);
  test(name + " installed version agrees with reviewed lock", () => {
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8")).version, metadata.version);
    assert.equal(metadata.version, versions[name]);
  });
  test(name + " has reviewed public default limits", () => {
    const wss = new WebSocket.Server({ noServer: true });
    try {
      assert.equal(wss.options.maxFragments, 16384);
      assert.equal(wss.options.maxBufferedChunks, 262144);
    } finally {
      wss.close();
    }
  });
  test(name + " counts empty fragments toward the explicit limit", async () => {
    const result = await receive(Receiver, major, [frame(1, false), frame(0, false), frame(0, true)], 2, 0);
    assertLimit(result.error, "Too many message fragments");
    assert.equal(result.messages.length, 0);
  });
  test(name + " rejects the third nonempty fragment", async () => {
    const result = await receive(
      Receiver,
      major,
      [frame(1, false, "a"), frame(0, false, "b"), frame(0, true, "c")],
      2,
      0,
    );
    assertLimit(result.error, "Too many message fragments");
    assert.equal(result.messages.length, 0);
  });
  test(name + " resets the fragment count for successive valid messages", async () => {
    const result = await receive(
      Receiver,
      major,
      [frame(1, false, "a"), frame(0, true, "b"), frame(1, false, "c"), frame(0, true, "d")],
      2,
      0,
    );
    assert.equal(result.error, undefined);
    assert.deepEqual(
      result.messages.map((message) => message.data.toString()),
      ["ab", "cd"],
    );
  });
  test(name + " bounds buffered chunks before a length header completes", async () => {
    const result = await receive(
      Receiver,
      major,
      [Buffer.from([0x82, 0x7f, 0]), Buffer.from([0]), Buffer.from([0])],
      0,
      2,
    );
    assertLimit(result.error, "Too many buffered chunks");
    assert.equal(result.messages.length, 0);
  });
  test(name + " accepts an incomplete header within the chunk boundary", async () => {
    const result = await receive(Receiver, major, [Buffer.from([0x82, 0x7f, 0]), Buffer.from([0])], 0, 2);
    assert.equal(result.error, undefined);
    assert.equal(result.messages.length, 0);
  });
  test(name + " preserves disabled-limit Unicode and binary messages", async () => {
    const binary = Buffer.from([0, 1, 254]);
    const result = await receive(
      Receiver,
      major,
      [frame(1, false), frame(0, false), frame(0, true), frame(1, true, "حافظ"), frame(2, true, binary)],
      0,
      0,
    );
    assert.equal(result.error, undefined);
    assert.deepEqual(
      result.messages.map((message) => message.data),
      [Buffer.alloc(0), Buffer.from("حافظ"), binary],
    );
    assert.deepEqual(
      result.messages.map((message) => message.binary),
      major === 7 ? [undefined, undefined, undefined] : [false, false, true],
    );
    assert.deepEqual(
      result.messages.map((message) => message.rawBuffer),
      major === 7 ? [false, false, true] : [true, true, true],
    );
  });
  for (const side of ["server", "client"])
    for (const compressed of [false, true]) {
      test(
        name + " public " + side + " limit and close code, compressed=" + compressed,
        { timeout: 6000 },
        async (t) => {
          await transport(t, WebSocket, side, compressed);
        },
      );
    }
}

test("declared dependency owners resolve their reviewed external WS instances", () => {
  const owners = {
    "node_modules/react-native": "node_modules/ws",
    "node_modules/@react-native/dev-middleware": "node_modules/ws",
    "node_modules/metro": "node_modules/ws",
    "node_modules/react-devtools-core": "node_modules/ws",
    "node_modules/@supabase/realtime-js": "node_modules/@supabase/realtime-js/node_modules/ws",
    "node_modules/jsdom": "node_modules/jsdom/node_modules/ws",
    "node_modules/expo/node_modules/@expo/cli": "node_modules/expo/node_modules/ws",
  };
  for (const [ownerPath, wsPath] of Object.entries(owners)) {
    const owner = createRequire(path.join(root, ownerPath, "package.json"));
    assert.equal(owner.resolve("ws"), require.resolve(path.join(root, wsPath)));
    assert.equal(owner("ws/package.json").version, versions[wsPath]);
  }
});
