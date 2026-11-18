import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cache, dependency, out, flags, surfaces, json, jobs, sharp } from "./common.mjs";
const browser = await dependency("playwright").chromium.launch({
  args: flags,
  env: {
    ...process.env,
    LD_LIBRARY_PATH:
      process.env.ZAYT_LD_LIBRARY_PATH || "/home/ehab/.local/share/elpsy-browser-runtime/root/usr/lib/x86_64-linux-gnu",
  },
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" }),
    errors = [],
    remote = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("request", (req) => {
    if (/^https?:/.test(req.url())) remote.push(req.url());
  });
  await page.context().setOffline(true);
  await page.goto(pathToFileURL(path.join(out, "gallery.html")).href);
  const loaded = () =>
    page.evaluate(async () => {
      await Promise.all([...document.images].map((img) => img.decode()));
      return document.documentElement.scrollWidth <= innerWidth;
    });
  for (const job of jobs) {
    await page.selectOption("#anim", job.id);
    await page.selectOption("#tier", job.tier);
    if (job.variant) await page.selectOption("#variant", job.variant);
    assert.ok(await loaded());
    assert.equal(await page.locator("img[data-moving]").count(), 0);
    if (job.poster) {
      await page.click("#replay");
      assert.equal(await page.locator("img[data-moving]").count(), 1);
      assert.ok(await loaded());
    }
  }
  await page.selectOption("#anim", "A04");
  for (const surface of surfaces) await page.selectOption("#surface", surface);
  await page.selectOption("#locale", "ar");
  assert.equal(await page.locator("#cards").getAttribute("dir"), "rtl");
  for (const mode of ["slot", "zoom", "session", "welcome-card"]) {
    await page.selectOption("#size", mode);
    await page.click("#replay");
    assert.equal(await page.locator("img[data-moving]").count(), 1);
    assert.ok(await loaded());
  }
  await page.selectOption("#size", "slot");
  await page.click("#replay");
  const image = page.locator("img[data-moving]");
  const t = Date.now();
  const shots = [];
  for (const ms of [0, 880, 2010, 2310]) {
    await page.waitForTimeout(Math.max(0, t + ms - Date.now()));
    shots.push(await image.screenshot({ animations: "allow" }));
  }
  assert.ok(!shots[0].equals(shots[1]));
  assert.ok(shots[2].equals(shots[3]));
  await page.click("#replay");
  await page.waitForTimeout(840);
  assert.ok(!(await image.screenshot()).equals(shots[3]));
  await page.selectOption("#anim", "A02");
  await page.click("#replay");
  await loaded();
  const loopStart = Date.now(),
    loopProof = [];
  for (const ms of [0, 2400, 4660, 4850, 7200, 9800, 10150]) {
    await page.waitForTimeout(Math.max(0, loopStart + ms - Date.now()));
    loopProof.push(
      await sharp(await image.screenshot())
        .removeAlpha()
        .raw()
        .toBuffer(),
    );
  }
  const rms = (a, b) => Math.sqrt(a.reduce((sum, byte, i) => sum + (byte - b[i]) ** 2, 0) / a.length);
  const seam = {
    firstPeak: rms(loopProof[0], loopProof[1]),
    acrossSeam: rms(loopProof[2], loopProof[3]),
    secondPeak: rms(loopProof[3], loopProof[4]),
    held: rms(loopProof[5], loopProof[6]),
  };
  assert.ok(seam.firstPeak > seam.acrossSeam && seam.secondPeak > seam.acrossSeam);
  assert.equal(seam.held, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(remote, []);
  json(path.join(cache, "gallery-check.json"), {
    jobs: jobs.length,
    width: 390,
    networkRequests: remote,
    errors,
    posterOnReducedMotion: true,
    replayAndHold: "A04",
    A02TwoCycleScreenRms: seam,
    slots: ["slot", "zoom", "session", "welcome-card"],
    rtl: true,
  });
  console.log(
    "All local gallery selections, Replay, loop seam, finite hold, card placement and offline checks passed.",
  );
} finally {
  await browser.close();
}
