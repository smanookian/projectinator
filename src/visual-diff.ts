// Visual delta between two screenshots: percentage of pixels that changed. A minimal
// PNG decoder (8-bit RGB/RGBA, non-interlaced — exactly what Chromium writes) on top of
// Node's zlib; no dependency. Rebuilds of the same task compare the 1280px shot with the
// previous round's so History can say "▲ 12% visual change".

import { inflateSync } from "node:zlib";

export interface Rgba { width: number; height: number; data: Uint8Array } // 4 bytes/px

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decode a PNG buffer. Throws on formats we don't handle (palette, 16-bit, interlaced). */
export function decodePng(buf: Buffer): Rgba {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8;
  let width = 0, height = 0, colorType = 0, bitDepth = 0, interlace = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      bitDepth = body[8]!; colorType = body[9]!; interlace = body[12]!;
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG (bitDepth ${bitDepth}, colorType ${colorType}, interlace ${interlace})`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++]!;
    const line = new Uint8Array(raw.subarray(src, src + stride));
    src += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      const x = line[i]!;
      line[i] = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c);
    }
    for (let px = 0; px < width; px++) {
      const o = (y * width + px) * 4, s = px * bpp;
      out[o] = line[s]!; out[o + 1] = line[s + 1]!; out[o + 2] = line[s + 2]!; out[o + 3] = bpp === 4 ? line[s + 3]! : 255;
    }
    prev = line;
  }
  return { width, height, data: out };
}

/** Fraction (0..1) of pixels that differ by more than `tolerance` on any channel. Images of
 *  different sizes compare over the overlap and count the extra area as changed. */
export function pixelDelta(a: Rgba, b: Rgba, tolerance = 16): number {
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  const total = Math.max(a.width * a.height, b.width * b.height);
  if (total === 0) return 0;
  let changed = total - w * h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * a.width + x) * 4, j = (y * b.width + x) * 4;
      if (Math.abs(a.data[i]! - b.data[j]!) > tolerance || Math.abs(a.data[i + 1]! - b.data[j + 1]!) > tolerance || Math.abs(a.data[i + 2]! - b.data[j + 2]!) > tolerance) changed++;
    }
  }
  return changed / total;
}

/** Percentage of visual change between two PNG files, or undefined if either can't be read. */
export function visualDeltaPct(prevPng: Buffer | undefined, nextPng: Buffer | undefined): number | undefined {
  if (!prevPng || !nextPng) return undefined;
  try {
    return Math.round(pixelDelta(decodePng(prevPng), decodePng(nextPng)) * 1000) / 10;
  } catch {
    return undefined;
  }
}
