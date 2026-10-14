import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeOutput } from "@/lib/core/code-runner";

// Windows Python emits CRLF; expected task outputs use LF. Without normalising,
// every multi-line task would fail on Windows for a reason unrelated to the code.

test("CRLF is normalised to LF", () => {
  assert.equal(normalizeOutput("a\r\nb\r\nc"), "a\nb\nc");
});

test("surrounding whitespace is trimmed", () => {
  assert.equal(normalizeOutput("  Привет, Аня!\n"), "Привет, Аня!");
});

test("CRLF and LF outputs compare equal", () => {
  assert.equal(normalizeOutput("Привет,\r\nАня!"), normalizeOutput("Привет,\nАня!"));
});

test("non-ASCII (Cyrillic) is preserved", () => {
  assert.equal(normalizeOutput("Тебе 15 лет.\r\n"), "Тебе 15 лет.");
});
