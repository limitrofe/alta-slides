import test from "node:test";
import assert from "node:assert/strict";
import { crc32 } from "../lib/crc32.js";

test("CRC-32 bate com o vetor clássico", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("CRC-32 de um buffer vazio", () => {
  assert.equal(crc32(new Uint8Array()), 0);
});
