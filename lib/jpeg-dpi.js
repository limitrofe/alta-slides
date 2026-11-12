const JFIF_IDENTIFIER = [0x4a, 0x46, 0x49, 0x46, 0x00]; // "JFIF\0"

/**
 * Grava a densidade (dpi) no segmento APP0/JFIF do JPEG. Não altera os pixels.
 *
 * @param {Uint8Array | ArrayBuffer} input
 * @param {number} dpi
 * @returns {Uint8Array}
 */
export function setJpegDpi(input, dpi) {
  const source = toBytes(input);
  const density = Math.round(Number(dpi));

  if (!Number.isFinite(density) || density < 1 || density > 65535) {
    throw new RangeError("Densidade inválida para o JPEG.");
  }
  if (source.length < 4 || source[0] !== 0xff || source[1] !== 0xd8) {
    throw new Error("Assinatura JPEG inválida.");
  }

  let offset = 2;
  while (offset + 4 <= source.length) {
    if (source[offset] !== 0xff) break;

    const marker = source[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }

    const length = (source[offset + 2] << 8) | source[offset + 3];
    if (length < 2) break;

    if (marker === 0xe0 && length >= 16 && matchesJfif(source, offset + 4)) {
      const output = source.slice();
      output[offset + 11] = 1; // unidade: dpi
      output[offset + 12] = (density >>> 8) & 0xff;
      output[offset + 13] = density & 0xff;
      output[offset + 14] = (density >>> 8) & 0xff;
      output[offset + 15] = density & 0xff;
      return output;
    }

    offset += 2 + length;
  }

  const app0 = new Uint8Array([
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x01,
    (density >>> 8) & 0xff,
    density & 0xff,
    (density >>> 8) & 0xff,
    density & 0xff,
    0x00,
    0x00,
  ]);

  const output = new Uint8Array(source.length + app0.length);
  output.set(source.subarray(0, 2), 0);
  output.set(app0, 2);
  output.set(source.subarray(2), 2 + app0.length);
  return output;
}

function matchesJfif(bytes, offset) {
  for (let index = 0; index < JFIF_IDENTIFIER.length; index += 1) {
    if (bytes[offset + index] !== JFIF_IDENTIFIER[index]) return false;
  }
  return true;
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError("Esperava bytes de imagem.");
}
