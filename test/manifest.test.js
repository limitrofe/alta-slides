import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));

test("manifesto MV3 consistente", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.name.includes("Alta"));
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.ok(manifest.permissions.includes("downloads"));
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.host_permissions.includes("https://docs.google.com/*"));
  assert.ok(manifest.host_permissions.includes("https://*.googleusercontent.com/*"));
});

test("todos os arquivos referenciados existem", () => {
  const files = new Set([
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap((script) => script.js),
  ]);
  for (const file of files) {
    assert.ok(existsSync(resolve(root, file)), `faltando: ${file}`);
  }
});

test("ícones têm as dimensões declaradas", () => {
  for (const [size, file] of Object.entries(manifest.icons)) {
    const bytes = readFileSync(resolve(root, file));
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    assert.equal(width, Number(size));
    assert.equal(height, Number(size));
  }
});

test("assets críticos do PDF.js e das fontes estão presentes", () => {
  const required = [
    "vendor/pdf.min.js",
    "vendor/pdf.worker.min.js",
    "vendor/cmaps/Adobe-Japan1-UCS2.bcmap",
    "vendor/standard_fonts/LiberationSans-Regular.ttf",
    "assets/fonts/archivo-latin.woff2",
    "assets/fonts/newsreader-latin.woff2",
    "assets/fonts/newsreader-italic-latin.woff2",
  ];
  for (const file of required) {
    assert.ok(existsSync(resolve(root, file)), `faltando: ${file}`);
  }
});

test("HTML referencia apenas arquivos locais existentes", () => {
  for (const file of ["popup.html", "renderer.html"]) {
    const html = readFileSync(resolve(root, file), "utf8");
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((ref) => !ref.startsWith("#") && !ref.startsWith("https://"));
    for (const ref of refs) {
      assert.ok(existsSync(resolve(root, ref)), `${file} aponta para ${ref}, que não existe`);
    }
  }
});
