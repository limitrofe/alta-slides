const SLIDES_SUFFIX = /\s+[-–—]\s+(?:Google Slides|Google Apresentações|Apresentações Google)\s*$/i;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const ILLEGAL_FILENAME = /[<>:"/\\|?*\u0000-\u001f]/g;

export function stripSlidesSuffix(title) {
  return String(title || "")
    .replace(SLIDES_SUFFIX, "")
    .trim();
}

export function sanitizeFilename(name, fallback = "Apresentação") {
  let clean = String(name || "")
    .normalize("NFC")
    .replace(ILLEGAL_FILENAME, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .trim();

  clean = Array.from(clean).slice(0, 96).join("");

  if (!clean) return fallback;
  if (WINDOWS_RESERVED.test(clean)) return `_${clean}`;
  return clean;
}

export function fileBaseName(title) {
  return sanitizeFilename(stripSlidesSuffix(title), "Apresentação");
}

const integerFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatInteger(value) {
  return integerFormatter.format(Math.round(value));
}

export function formatDecimal(value) {
  return decimalFormatter.format(value);
}
