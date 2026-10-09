# Handoff — ZEROK-1 + ZEROK-2 + ZEROK-3 + ZEROK-4

Дата: 2026-10-09

## Статус

- ZEROK-1 integration: **complete**.
- ZEROK-2 validation: **complete**.
- ZEROK-3 integration: **complete in code**.
- ZEROK-4 core: **complete**.
- Unit and network-free integration tests: **passed**.
- Docker integration tests: **not run in this environment** (Docker CLI есть,
  daemon недоступен; 12 тестов корректно пропущены).
- Real E2E smoke test: **NOT RUN** (`DEEPSEEK_API_KEY` отсутствует и Docker
  daemon недоступен).

## Фактическая интеграция ZEROK-1

Актуальный `origin/main` после `git fetch` содержит ZEROK-1 в
`zero_knowledge.llm.DeepSeekClient`. Используется его существующий метод
`generate(prompt: str) -> str`, который уже структурно соответствует
`TaskGenerationProvider` ZEROK-4. Отдельный adapter и второй API layer не
создавались.

`DeepSeekClient` отправляет OpenAI-совместимый `POST /chat/completions` в JSON
mode, поддерживает model/base URL/timeout/retries/max tokens, извлекает JSON из
ответа и преобразует auth, HTTP, timeout и transport failures в
`ProviderUnavailableError`. Низкоуровневые методы `chat()` и `chat_json()`
также сохранены. API key читается из `DEEPSEEK_API_KEY`; остальные переменные
описаны в `.env.example`. `.env` исключён из Git и автоматически не загружается.

## Фактическая интеграция ZEROK-3

`zero_knowledge.execution.DockerIsolatedExecutionRunner` из актуального
`origin/main` напрямую реализует
`IsolatedExecutionRunner.verify_reference(task, solution, tests)`. Отдельный
adapter и вторая песочница не создавались. Строгий `TaskBlockService.generate()`
возвращается успешно только после запуска всех эталонов через ZEROK-3.
`generate_without_reference_execution()` остаётся явным preview-режимом с
результатом `UNVERIFIED`.

Несовпадение вывода, runtime error, memory error и timeout эталона считаются
content failure и участвуют в ограниченных повторах генерации. Недоступный
Docker CLI/daemon/образ преобразуется в `IsolatedExecutionUnavailableError` и
не запускает бессмысленную повторную генерацию.

## Изменения

- `src/zero_knowledge/llm/` — фактический DeepSeek client ZEROK-1 из
  актуального `origin/main`.
- `src/zero_knowledge/task_generation/orchestrator.py` — безопасный
  preview-режим, отдельный `UnverifiedTaskBlock` и число использованных попыток.
- `src/zero_knowledge/execution/`, `infra/sandbox/` — фактический Docker runner
  ZEROK-3 из актуального `origin/main`.
- `scripts/demo_task_generation.py` — строгий полный запуск по умолчанию и
  опциональный `--preview`.
- `tests/test_deepseek_client.py` — network-free тесты клиента.
- `tests/test_deepseek_task_generation_integration.py` — direct seam tests
  ZEROK-1 → ZEROK-4 на `httpx.MockTransport`.
- `tests/test_execution.py`, `tests/test_execution_adapter.py` — реальная
  Docker-интеграция и network/Docker-free тесты границы ZEROK-3 → ZEROK-4.
- `pyproject.toml`, `.env.example`, `README.md`, `docs/zerok-4.md` — зависимость,
  конфигурация и инструкции запуска.

## Запуск real DeepSeek demo

```powershell
uv pip install --python .\.venv\Scripts\python.exe -e ".[dev]"
docker build -t zero-knowledge/sandbox:latest infra/sandbox
$env:DEEPSEEK_API_KEY = "..."
.\.venv\Scripts\python.exe scripts\demo_task_generation.py
```

Для командного LiteLLM gateway также задаётся фактический endpoint из шаблона:

```powershell
$env:DEEPSEEK_BASE_URL = "https://llm.azati.ai/v1"
```

Значение ключа нельзя сохранять в репозитории или выводить в лог.

Только генерация и schema validation без исполнения кода:

```powershell
.\.venv\Scripts\python.exe scripts\demo_task_generation.py --preview
```

## Выполненные проверки

- ZEROK-4 + ZEROK-1 seam: **20 passed**.
- ZEROK-3 → ZEROK-4 adapter seam: **10 passed**.
- ZEROK-3 Docker integration: **12 skipped**, потому что Docker daemon
  недоступен.
- Полный `pytest`: **56 passed, 12 skipped**.
- Ruff для изменённого Python scope: **passed**.
- Полный Ruff check обнаружил 4 существующих замечания в ZEROK-2 schemas;
  полный format check — 10 ранее неформатированных файлов ZEROK-2. Эти
  несвязанные файлы не изменялись.
- `python -m compileall -q src scripts tests`: **passed**.
- Demo без ключа: ожидаемый exit code `2` и понятное сообщение без traceback.
- Настоящий E2E smoke test: **не выполнялся**, потому что
  `DEEPSEEK_API_KEY` отсутствует, а Docker daemon недоступен.

## Ограничения и следующий шаг

Текущая машина не подтвердила реальный контейнерный запуск. Прохождение
эталоном сгенерированных тестов подтверждает согласованность эталона и этих
тестов, но не доказывает полную семантическую корректность условия задачи.
ZEROK-3 читает stdout/stderr целиком до обрезки в 256 КБ; bounded streaming
остаётся отдельной доработкой.

Следующий шаг: запустить Docker daemon, собрать
`zero-knowledge/sandbox:latest`, передать `DEEPSEEK_API_KEY` через окружение и
выполнить строгий demo. Только после успешного реального запуска можно отметить
полный E2E как verified.
