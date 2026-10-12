const DEFAULT_TIMEOUT_MS = 120_000;

export class ApiClientError extends Error {
  constructor(message, { code = "network_error", status = 0, retryable = true } = {}) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

async function request(path, { body = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    const message = error.name === "AbortError"
      ? "Backend не ответил вовремя. Повторите запрос."
      : "Не удалось связаться с backend. Проверьте, что сервер запущен.";
    throw new ApiClientError(message);
  } finally {
    clearTimeout(timer);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError("Backend вернул некорректный ответ.", {
      code: "invalid_response",
      status: response.status,
    });
  }
  if (!response.ok) {
    const details = payload?.error || {};
    throw new ApiClientError(details.message || `Ошибка backend (HTTP ${response.status}).`, {
      code: details.code,
      status: response.status,
      retryable: details.retryable,
    });
  }
  return payload;
}

export const api = {
  createDiagnostic: () => request("/api/diagnostics", { timeoutMs: 180_000 }),
  submitSolution: (sessionId, taskId, code) => request(
    `/api/diagnostics/${sessionId}/tasks/${taskId}/submissions`,
    { body: { code } },
  ),
  createReviews: (sessionId) => request(`/api/diagnostics/${sessionId}/reviews`, { timeoutMs: 180_000 }),
  submitExplanations: (sessionId, answers) => request(
    `/api/diagnostics/${sessionId}/explanations`,
    { body: { answers } },
  ),
  getProfile: (sessionId) => request(`/api/diagnostics/${sessionId}/profile`, { timeoutMs: 180_000 }),
  getRoadmap: (sessionId) => request(`/api/diagnostics/${sessionId}/roadmap`, { timeoutMs: 180_000 }),
};
