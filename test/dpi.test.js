import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setPngDpi } from "../lib/png-dpi.js";
import { setJpegDpi } from "../lib/jpeg-dpi.js";
import { crc32 } from "../lib/crc32.js";

const fixture = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

function pngChunks(bytes) {
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const crc = new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset + 8 + length);
    chunks.push({ type, data, crc, crcOk: crc32(bytes.subarray(offset + 4, offset + 8 + length)) === crc });
    if (type === "IEND") break;
    offset += 12 + length;
  }
  return chunks;
}

function jpegJfif(bytes) {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker === 0xe0 && length >= 16) {
      return {
        units: bytes[offset + 11],
        x: (bytes[offset + 12] << 8) | bytes[offset + 13],
        y: (bytes[offset + 14] << 8) | bytes[offset + 15],
      };
    }
    offset += 2 + length;
  }
  return null;
}

test("grava 300 dpi no pHYs do PNG sem tocar nos pixels", () => {
  const original = fixture("sample.png");
  const patched = setPngDpi(original, 300);
  const chunks = pngChunks(patched);
  const phys = chunks.filter((chunk) => chunk.type === "pHYs");
  assert.equal(phys.length, 1);

  const view = new DataView(phys[0].data.buffer, phys[0].data.byteOffset);
  const expected = Math.round(300 * 39.37007874015748);
  assert.equal(view.getUint32(0), expected);
  assert.equal(view.getUint32(4), expected);
  assert.equal(phys[0].data[8], 1);
  assert.equal(phys[0].crcOk, true);

  const originalIdat = pngChunks(original).filter((chunk) => chunk.type === "IDAT").map((c) => [...c.data]);
  const patchedIdat = chunks.filter((chunk) => chunk.type === "IDAT").map((c) => [...c.data]);
  assert.deepEqual(patchedIdat, originalIdat);
});

test("substitui um pHYs existente em vez de duplicar", () => {
  const patched = setPngDpi(fixture("sample.png"), 300);
  const again = setPngDpi(patched, 150);
  const phys = pngChunks(again).filter((chunk) => chunk.type === "pHYs");
  assert.equal(phys.length, 1);
  const view = new DataView(phys[0].data.buffer, phys[0].data.byteOffset);
  assert.equal(view.getUint32(0), Math.round(150 * 39.37007874015748));
});

test("rejeita bytes que não são PNG", () => {
  assert.throws(() => setPngDpi(new Uint8Array([1, 2, 3]), 300));
});

test("grava 300 dpi no APP0/JFIF do JPEG", () => {
  const patched = setJpegDpi(fixture("sample.jpg"), 300);
  assert.deepEqual(jpegJfif(patched), { units: 1, x: 300, y: 300 });
});

test("insere APP0 quando o JPEG não tem JFIF", () => {
  const original = fixture("sample.jpg");
  const withoutJfif = removeJfif(original);
  assert.equal(jpegJfif(withoutJfif), null);
  const patched = setJpegDpi(withoutJfif, 300);
  assert.deepEqual(jpegJfif(patched), { units: 1, x: 300, y: 300 });
  assert.equal(patched[0], 0xff);
  assert.equal(patched[1], 0xd8);
});

test("rejeita bytes que não são JPEG", () => {
  assert.throws(() => setJpegDpi(new Uint8Array([1, 2, 3]), 300));
});

function removeJfif(bytes) {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker === 0xe0) {
      return new Uint8Array([...bytes.subarray(0, offset), ...bytes.subarray(offset + 2 + length)]);
    }
    if (marker === 0xda || marker === 0xd9) break;
    offset += 2 + length;
  }
  return bytes;
}
