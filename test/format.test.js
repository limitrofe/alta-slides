import test from "node:test";
import assert from "node:assert/strict";
import { stripSlidesSuffix, sanitizeFilename, fileBaseName, formatInteger, formatDecimal } from "../lib/format.js";

test("remove o sufixo que o Chrome acrescenta ao título", () => {
  assert.equal(stripSlidesSuffix("Plano 2027 - Google Slides"), "Plano 2027");
  assert.equal(stripSlidesSuffix("Plano 2027 – Apresentações Google"), "Plano 2027");
  assert.equal(stripSlidesSuffix("Plano 2027 — Google Slides"), "Plano 2027");
  assert.equal(stripSlidesSuffix("Plano 2027"), "Plano 2027");
});

test("mantém hífens internos do título", () => {
  assert.equal(stripSlidesSuffix("2026 - Retrospectiva - Google Slides"), "2026 - Retrospectiva");
});

test("limpa caracteres inválidos de nome de arquivo", () => {
  assert.equal(sanitizeFilename('Deck: "final" / v2?'), "Deck final v2");
  assert.equal(sanitizeFilename("  ...  "), "Apresentação");
  assert.equal(sanitizeFilename("CON"), "_CON");
  assert.equal(sanitizeFilename("", "Queda"), "Queda");
});

test("limita nomes muito longos sem quebrar caracteres", () => {
  const long = "a".repeat(200);
  assert.equal(sanitizeFilename(long).length, 96);
});

test("nome-base usa o título tratado", () => {
  assert.equal(fileBaseName("Relatório: Q3 - Google Slides"), "Relatório Q3");
});

test("formatação pt-BR", () => {
  assert.equal(formatInteger(6000), "6.000");
  assert.equal(formatDecimal(50.8), "50,8");
});
