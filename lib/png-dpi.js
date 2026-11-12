import { crc32 } from "./crc32.js";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PHYS_CHUNK_SIZE = 21; // 4 comprimento + 4 tipo + 9 dados + 4 crc
const METERS_PER_INCH = 39.37007874015748;

/**
 * Grava a densidade (dpi) no bloco pHYs do PNG, que é o metadado lido por
 * Photoshop, Affinity, Preview etc. Não altera os pixels.
 *
 * @param {Uint8Array | ArrayBuffer} input
 * @param {number} dpi
 * @returns {Uint8Array}
 */
export function setPngDpi(input, dpi) {
  const source = toBytes(input);
  assertPng(source);

  const density = Math.round(Number(dpi));
  if (!Number.isFinite(density) || density < 1 || density > 1000000) {
    throw new RangeError("Densidade inválida para o PNG.");
  }
  const pixelsPerMeter = Math.round(density * METERS_PER_INCH);

  let offset = 8;
  while (offset + 12 <= source.length) {
    const length = readUint32(source, offset);
    const type = readType(source, offset + 4);
    if (length > source.length - offset - 12) break;

    if (type === "pHYs" && length === 9) {
      const output = source.slice();
      writeUint32(output, offset + 8, pixelsPerMeter);
      writeUint32(output, offset + 12, pixelsPerMeter);
      output[offset + 16] = 1;
      writeUint32(output, offset + 17, crc32(output.subarray(offset + 4, offset + 17)));
      return output;
    }

    if (type === "IDAT" || type === "IEND") break;
    offset += 12 + length;
  }

  if (readUint32(source, 8) !== 13 || readType(source, 12) !== "IHDR") {
    throw new Error("PNG sem cabeçalho IHDR válido.");
  }

  const insertAt = 8 + 12 + 13;
  const chunk = new Uint8Array(PHYS_CHUNK_SIZE);
  const chunkView = new DataView(chunk.buffer);

  chunkView.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // pHYs
  chunkView.setUint32(8, pixelsPerMeter);
  chunkView.setUint32(12, pixelsPerMeter);
  chunk[16] = 1; // unidade: metro
  chunkView.setUint32(17, crc32(chunk.subarray(4, 17)));

  const output = new Uint8Array(source.length + PHYS_CHUNK_SIZE);
  output.set(source.subarray(0, insertAt), 0);
  output.set(chunk, insertAt);
  output.set(source.subarray(insertAt), insertAt + PHYS_CHUNK_SIZE);
  return output;
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError("Esperava bytes de imagem.");
}

function assertPng(bytes) {
  if (bytes.length < 33) throw new Error("Arquivo PNG curto demais.");
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) {
      throw new Error("Assinatura PNG inválida.");
    }
  }
}

function readType(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function readUint32(bytes, offset) {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function writeUint32(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}
