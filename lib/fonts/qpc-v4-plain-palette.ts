const SFNT_CHECKSUM = 0xb1b0afba;
const CPAL_TAG = 0x4350414c;
const HEAD_TAG = 0x68656164;
const PLAIN_PALETTE = 3;

function findTable(view: DataView, tag: number) {
  const tableCount = view.getUint16(4);
  for (let entry = 12; entry < 12 + tableCount * 16; entry += 16) {
    if (view.getUint32(entry) !== tag) continue;
    const offset = view.getUint32(entry + 8);
    const length = view.getUint32(entry + 12);
    if (offset <= view.byteLength && length <= view.byteLength - offset) {
      return { entry, offset, length };
    }
    break;
  }
  throw new Error("QPC V4 font is missing a required table");
}

function checksum(view: DataView, offset: number, length: number): number {
  const end = offset + length;
  let sum = 0;
  for (; offset + 4 <= end; offset += 4) {
    sum = (sum + view.getUint32(offset)) >>> 0;
  }
  for (let shift = 24; offset < end; offset += 1, shift -= 8) {
    sum = (sum + (view.getUint8(offset) << shift)) >>> 0;
  }
  return sum;
}

/** Selects the font's bundled plain palette in a disposable copy for Android's font loader. */
export function selectQpcV4PlainPalette(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 12 || view.getUint32(0) !== 0x00010000 || 12 + view.getUint16(4) * 16 > view.byteLength) {
    throw new Error("Invalid QPC V4 TrueType font");
  }
  const { entry, offset, length } = findTable(view, CPAL_TAG);
  const head = findTable(view, HEAD_TAG);
  const defaultPalette = offset + 12;
  const plainPalette = defaultPalette + PLAIN_PALETTE * 2;
  if (
    plainPalette + 2 > offset + length ||
    view.getUint16(offset + 4) <= PLAIN_PALETTE ||
    head.length < 12
  ) {
    throw new Error("QPC V4 font is missing its plain palette");
  }

  // Android selects palette zero. Point it at the existing monochrome colors and marker colors.
  // The glyphs, their layers and every other palette keep their original bytes.
  view.setUint16(defaultPalette, view.getUint16(plainPalette));
  view.setUint32(entry + 4, checksum(view, offset, length));
  const adjustment = head.offset + 8;
  view.setUint32(adjustment, 0);
  view.setUint32(adjustment, (SFNT_CHECKSUM - checksum(view, 0, view.byteLength)) >>> 0);
}
