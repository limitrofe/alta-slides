import { crc32 } from "./crc32.js";

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const MAX_UINT32 = 0xffffffff;
const MAX_ENTRIES = 0xffff;

export class ZipLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = "ZipLimitError";
    this.code = "ZIP_LIMIT";
  }
}

/**
 * Cria uma entrada de ZIP a partir dos bytes já codificados.
 * @param {string} name
 * @param {Uint8Array} bytes
 * @param {string} [type]
 */
export function makeZipEntry(name, bytes, type = "application/octet-stream") {
  return {
    name,
    blob: new Blob([bytes], { type }),
    crc: crc32(bytes),
    size: bytes.length,
  };
}

/**
 * Monta um ZIP sem compressão (método store). As imagens já são comprimidas,
 * então recomprimir só gastaria tempo. A montagem usa Blobs para não duplicar
 * todos os arquivos em memória.
 *
 * @param {Array<{name: string, blob: Blob, crc: number, size: number}>} entries
 * @returns {Blob}
 */
export function createZipBlob(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new ZipLimitError("Não há imagens para incluir no ZIP.");
  }
  if (entries.length > MAX_ENTRIES) {
    throw new ZipLimitError("São slides demais para um único ZIP. Exporte em arquivos separados.");
  }

  const encoder = new TextEncoder();
  const dos = dosDateTime(new Date());
  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    if (!(entry?.blob instanceof Blob)) {
      throw new TypeError(`Entrada de ZIP inválida: ${entry?.name || "sem nome"}.`);
    }
    if (!Number.isInteger(entry.size) || entry.size < 0 || entry.size !== entry.blob.size) {
      throw new TypeError(`Tamanho inconsistente no ZIP: ${entry.name}.`);
    }
    if (offset + 30 + entry.size > MAX_UINT32) {
      throw new ZipLimitError("O ZIP passaria de 4 GB. Exporte em arquivos separados.");
    }

    const nameBytes = encoder.encode(entry.name);
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);

    view.setUint32(0, LOCAL_HEADER, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, UTF8_FLAG, true);
    view.setUint16(8, STORE_METHOD, true);
    view.setUint16(10, dos.time, true);
    view.setUint16(12, dos.date, true);
    view.setUint32(14, entry.crc >>> 0, true);
    view.setUint32(18, entry.size, true);
    view.setUint32(22, entry.size, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    header.set(nameBytes, 30);

    parts.push(header, entry.blob);
    central.push({ entry, nameBytes, offset });
    offset += header.length + entry.size;
  }

  const centralOffset = offset;
  let centralSize = 0;

  for (const item of central) {
    const { entry, nameBytes, offset: localOffset } = item;
    const header = new Uint8Array(46 + nameBytes.length);
    const view = new DataView(header.buffer);

    view.setUint32(0, CENTRAL_HEADER, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, UTF8_FLAG, true);
    view.setUint16(10, STORE_METHOD, true);
    view.setUint16(12, dos.time, true);
    view.setUint16(14, dos.date, true);
    view.setUint32(16, entry.crc >>> 0, true);
    view.setUint32(20, entry.size, true);
    view.setUint32(24, entry.size, true);
    view.setUint16(28, nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, localOffset, true);
    header.set(nameBytes, 46);

    parts.push(header);
    centralSize += header.length;
  }

  if (centralOffset + centralSize > MAX_UINT32) {
    throw new ZipLimitError("O ZIP passaria de 4 GB. Exporte em arquivos separados.");
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, END_OF_CENTRAL, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  endView.setUint16(20, 0, true);
  parts.push(end);

  return new Blob(parts, { type: "application/zip" });
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}
