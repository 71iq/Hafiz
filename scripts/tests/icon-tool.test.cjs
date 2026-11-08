const assert = require("node:assert/strict");
const { test } = require("node:test");
const sharp = require("sharp");

// Exercise SVG decoding and PNG encoding in memory. Never import generate-icons.mjs.
test("converts a synthetic SVG to PNG with the expected dimensions and pixels", async () => {
  const input = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"><rect width="2" height="3" fill="#ff0000"/></svg>',
  );
  const original = Buffer.from(input);
  const png = await sharp(input).png().toBuffer();
  assert.deepEqual(input, original);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 2);
  assert.equal(metadata.height, 3);
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  assert.deepEqual([...data], Array.from({ length: 6 }, () => [255, 0, 0, 255]).flat());
});

test("preserves transparent pixels around a synthetic monochrome SVG shape", async () => {
  const input = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"><rect x="1" width="1" height="2" fill="#ffffff"/></svg>',
  );
  const png = await sharp(input).png().toBuffer();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 3);
  assert.equal(info.height, 2);
  assert.equal(info.channels, 4);
  assert.deepEqual(
    [...data],
    Array.from({ length: 2 }, () => [
      [0, 0, 0, 0],
      [255, 255, 255, 255],
      [0, 0, 0, 0],
    ]).flat(2),
  );
});

test("rejects invalid input instead of returning PNG data", async () => {
  await assert.rejects(sharp(Buffer.from("Not an image")).png().toBuffer());
});
