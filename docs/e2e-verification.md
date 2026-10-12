# Верификация сквозного сценария (ZEROK-7)

> Ветка: `docs/e2e-verification`
> Дата: 2026-10-12
> Статус: сквозной сценарий **подтверждён на реальных модулях** (DeepSeek + Docker), без заглушек.

## Контекст

Задача «Подключение реальных модулей к интерфейсу» (генерация, исполнение,
вопросы, профиль, roadmap через минимальный Python API; ключ только на бэкенде)
реализована в `main` как **ZEROK-7** (PR #7, доводка #10). Эта ветка фиксирует
**верификацию**: настройку окружения, автотесты, ревизию wiring и живой прогон
всего сценария через API на реальном ключе.

## Проверка окружения

- Python 3.14, uv 0.11, Docker daemon 29.8.0, node v26.
- Зависимости: `uv pip install --python .\.venv\Scripts\python.exe -e ".[dev]"` → `httpx 0.28.1`.
- Образ: `docker build -t zero-knowledge/sandbox:latest infra/sandbox` → 187 МБ.

## Автотесты

- `pytest`: **116 passed, 0 failed** — включая Docker-integration тесты, которые
  ранее (в handoff) пропускались из-за недоступного daemon.

## Ревизия wiring — заглушек нет

- `web_app/server.py` собирает реальные: `DeepSeekClient`, `DockerSandbox`,
  `TaskBlockService`, `StudentSolutionEvaluator`, `SolutionReviewService`,
  `ProfileRoadmapService`.
- `task_generation/stubs.py`, `solution_review/stubs.py` — только фикстуры тестов
  (`Unavailable*`), в рантайм-пути не участвуют.
- Фронтенд: `web/index.html` → `app.js` → `api.js`; `mock-data.js` интерфейсом не
  загружается.
- `grep` по `src/` на `TODO/FIXME/mock/NotImplemented` — пусто.
- Ключ `DEEPSEEK_API_KEY` используется только серверным процессом.

## Живой прогон (реальные модули, реальный ключ)

Все шаги — через Python API (`http://127.0.0.1:8000`), все ответы HTTP 200:

| Шаг API | Результат |
|---|---|
| `POST /api/diagnostics` | 3 задачи: easy «Сумма двух чисел», medium «Подсчёт слов в строке», hard «Максимальная сумма подмассива»; эталоны проверены в Docker |
| `POST …/submissions` ×3 | `passed` ×3 — код реально исполнялся в Docker-песочнице |
| `POST …/reviews` | 14 AI-вопросов по решениям (5+4+5) |
| `POST …/explanations` | 14 ответов принято; оценки 3× `expert` (`is_correct=true`, `independence=1.0`) |
| `POST …/profile` | профиль: 6 навыков → `expert` + LLM-резюме |
| `POST …/roadmap` | шаг `transfer` + 6 объяснимых рекомендаций с rationale |

## Как запустить

```powershell
uv pip install --python .\.venv\Scripts\python.exe -e ".[dev]"
docker build -t zero-knowledge/sandbox:latest infra/sandbox
$env:DEEPSEEK_API_KEY = "sk-…"
$env:DEEPSEEK_BASE_URL = "https://llm.azati.ai/v1"
.\.venv\Scripts\python.exe -m zero_knowledge.web_app --host 127.0.0.1 --port 8000
```

Открыть <http://127.0.0.1:8000/> и пройти: «Начать диагностику» → 3 задачи →
вопросы AI → профиль → roadmap.

## Наблюдения и рекомендации

1. **Флейкинг генерации.** Первый `POST /api/diagnostics` вернул 502
   `generation_invalid` (три попытки LLM не дали валидный блок), повторный
   запрос — успех. Рекомендация: поднять `max_attempts` в `TaskBlockService`
   (сейчас 3) и/или добавить автоматический повтор на стороне UI.
2. **Безопасность ключа.** Ключ передаётся только через окружение серверного
   процесса, во фронтенд и логи не попадает. Перевыпускать ключ, если он был
   опубликован в чате/тикетах.
3. **Первый клик «Начать диагностику» занимает 30–90 с** (генерация + Docker) —
   это штатно, не прерывать запрос.
