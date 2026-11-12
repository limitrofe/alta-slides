import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createZipBlob, makeZipEntry, ZipLimitError } from "../lib/zip.js";

test("cria um ZIP válido que o unzip consegue extrair", async () => {
  const first = new TextEncoder().encode("primeiro slide");
  const second = new TextEncoder().encode("segundo slide");
  const zip = createZipBlob([
    makeZipEntry("slide-01.txt", first, "text/plain"),
    makeZipEntry("slide-02.txt", second, "text/plain"),
  ]);

  assert.ok(zip instanceof Blob);
  assert.equal(zip.type, "application/zip");

  const dir = mkdtempSync(join(tmpdir(), "alta-zip-"));
  const file = join(dir, "teste.zip");
  try {
    writeFileSync(file, Buffer.from(await zip.arrayBuffer()));
    execFileSync("unzip", ["-t", file], { stdio: "pipe" });
    const extracted = execFileSync("unzip", ["-p", file, "slide-02.txt"]);
    assert.equal(extracted.toString(), "segundo slide");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("marca nomes em UTF-8 no cabeçalho", () => {
  const zip = createZipBlob([makeZipEntry("Relatório/01.png", new Uint8Array([1, 2, 3]))]);
  return zip.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    assert.equal(view.getUint16(6, true) & 0x0800, 0x0800);
    assert.ok(bytes.some((_, index) => bytes[index] === 0x52 && bytes[index + 1] === 0x65));
  });
});

test("rejeita ZIP vazio", () => {
  assert.throws(() => createZipBlob([]), ZipLimitError);
});

test("rejeita entrada com tamanho inconsistente", () => {
  const entry = makeZipEntry("a.txt", new Uint8Array([1]));
  entry.size = 2;
  assert.throws(() => createZipBlob([entry]), TypeError);
});

test("aceita acentos e caminhos internos", async () => {
  const content = new TextEncoder().encode("ok");
  const zip = createZipBlob([makeZipEntry("Apresentação/slide-01.png", content, "image/png")]);
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.includes("Apresentação/slide-01.png"));
});

test("fixture local continua intacta", () => {
  const bytes = readFileSync(new URL("./fixtures/sample.png", import.meta.url));
  assert.ok(bytes.length > 0);
});
