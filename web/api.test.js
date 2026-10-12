import assert from "node:assert/strict";
import test from "node:test";

import { api, ApiClientError } from "./api.js";

test("API client uses the real diagnostic endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (path, options) => {
    request = { path, options };
    return new Response(JSON.stringify({ session_id: "session" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const result = await api.createDiagnostic();
    assert.equal(request.path, "/api/diagnostics");
    assert.equal(request.options.method, "POST");
    assert.equal(result.session_id, "session");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("structured backend errors remain visible and retryable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: {
      code: "sandbox_unavailable",
      message: "Docker sandbox недоступна.",
      retryable: true,
    },
  }), { status: 503, headers: { "Content-Type": "application/json" } });
  try {
    await assert.rejects(
      api.submitSolution("session", "task", "print(1)"),
      (error) => error instanceof ApiClientError
        && error.code === "sandbox_unavailable"
        && error.status === 503
        && error.retryable === true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("network failures do not fall back to mock data", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("connection refused"); };
  try {
    await assert.rejects(
      api.getProfile("session"),
      /Не удалось связаться с backend/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
