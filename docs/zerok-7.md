# ZEROK-7 — веб-интерфейс сквозной диагностики

ZEROK-7 — локальный/server-ready PoC на HTML, CSS и vanilla JavaScript. Один
Python-процесс раздаёт статические файлы и JSON API; секреты, эталонные решения,
скрытые тесты и состояние диагностики остаются на backend.

## Архитектура

```text
Browser (web/)
  │ same-origin JSON
  ▼
zero_knowledge.web_app
  ├─ ZEROK-4 TaskBlockService
  │    ├─ ZEROK-1 DeepSeekClient
  │    ├─ ZEROK-2 Pydantic schemas
  │    └─ ZEROK-3 DockerIsolatedExecutionRunner
  ├─ ZEROK-3 DockerSandbox (решения пользователя)
  ├─ ZEROK-5 SolutionReviewService
  └─ ZEROK-6 LearningPathService
       ├─ ZEROK-1 DeepSeekClient
       └─ KnowledgeProfile / Roadmap schemas
```

`DiagnosticService` хранит сессии в памяти процесса. В закрытой части сессии
находятся `ReferenceSolution` и `TestCase`; браузер получает только публичные
поля `Task` и открытые примеры (`is_hidden=false`). Число попыток назначает
backend, а переходы между задачами проверяются и в UI, и на сервере.

### Использование ZEROK-1—6

- **ZEROK-1:** один `DeepSeekClient` вызывается только backend-процессом.
- **ZEROK-2:** запросы AI валидируются фактическими `Task`,
  `ReferenceSolution`, `TestCase`, `SolutionReview`, `KnowledgeProfile` и
  `Roadmap`.
- **ZEROK-3:** эталонные решения и код пользователя исполняются одним
  `DockerSandbox`; web-server не использует `eval()` или `exec()`.
- **ZEROK-4:** используется только строгий `TaskBlockService.generate()`.
  Preview/`UNVERIFIED` путь web-приложением не вызывается.
- **ZEROK-5:** `SolutionReviewService` генерирует вопросы по фактическому
  `Answer.content`; `UnderstandingAssessment` рассчитывается существующей
  моделью по корректности и использованным подсказкам.
- **ZEROK-6:** `LearningPathService` оформляет существовавший DeepSeek-spike в
  bounded/retry сервис и валидирует профиль и roadmap каноническими схемами.

Ответы на `SolutionQuestion` сохраняются как наблюдения для ZEROK-6. Текущий
публичный интерфейс ZEROK-5 не содержит отдельной схемы или сервиса
семантической оценки этих текстов, поэтому UI честно показывает реальный
`UnderstandingAssessment` ZEROK-5 (корректность + самостоятельность), а не
выдуманную оценку качества объяснений.

## Локальный запуск

Требования: Python 3.11+, Docker с запущенным daemon и API-ключ DeepSeek.

```powershell
uv pip install --python .\.venv\Scripts\python.exe -e ".[dev]"
docker build -t zero-knowledge/sandbox:latest infra/sandbox
$env:DEEPSEEK_API_KEY = "ваш-ключ"
.\.venv\Scripts\python.exe -m zero_knowledge.web_app --host 127.0.0.1 --port 8000
```

Откройте <http://127.0.0.1:8000/>. Статический `python -m http.server` для
основного сценария больше не подходит: он не предоставляет API.

`.env` автоматически не загружается. Переменные нужно передать процессу через
окружение. Настройки:

- `DEEPSEEK_API_KEY` — обязательна;
- `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `DEEPSEEK_TIMEOUT`,
  `DEEPSEEK_MAX_RETRIES`, `DEEPSEEK_MAX_TOKENS` — настройки ZEROK-1;
- `ZK_SANDBOX_IMAGE`, `ZK_SANDBOX_MEMORY`, `ZK_SANDBOX_CPUS`,
  `ZK_SANDBOX_PIDS_LIMIT`, `ZK_SANDBOX_TMPFS_SIZE`, `ZK_SANDBOX_TIMEOUT`,
  `ZK_SANDBOX_NETWORK`, `ZK_SANDBOX_USER` — настройки ZEROK-3.

## API

Все изменяющие состояние маршруты используют `POST`, JSON и same-origin URL.

| Endpoint | Назначение |
|---|---|
| `GET /api/health` | Проверка HTTP-процесса |
| `POST /api/diagnostics` | Строгая генерация и проверка блока easy → medium → hard |
| `POST /api/diagnostics/{session}/tasks/{task}/submissions` | Проверка `{ "code": "..." }` в Docker |
| `POST /api/diagnostics/{session}/reviews` | Вопросы и assessment ZEROK-5 |
| `POST /api/diagnostics/{session}/explanations` | Сохранение ответов на вопросы |
| `POST /api/diagnostics/{session}/profile` | Профиль знаний ZEROK-6 |
| `POST /api/diagnostics/{session}/roadmap` | Roadmap ZEROK-6 |

Ошибки имеют единый envelope:

```json
{
  "error": {
    "code": "sandbox_unavailable",
    "message": "...",
    "retryable": true
  }
}
```

Отдельно различаются ошибка провайдера, невалидный ответ генерации, отсутствие
Docker, неверный запрос, недопустимый переход сессии и неизвестный ресурс.
Ошибки решения (`incorrect_output`, `syntax_error`, `runtime_error`, `timeout`)
возвращаются как результат попытки, а не как падение HTTP API.

## Normal mode и mock-data

Обычный `index.html` импортирует только `web/api.js` и всегда обращается к
реальному backend. Тихого fallback на mock нет. `web/mock-data.js` сохранён как
изолированный development fixture для прежних unit-тестов; UI его не загружает.
Пустой mock-`Answer` по-прежнему отклоняется тем же правилом, что и схема
ZEROK-5.

## Ручной smoke-test

1. Запустите Docker, соберите image, задайте `DEEPSEEK_API_KEY`, запустите
   сервер и откройте URL выше.
2. Нажмите **«Начать диагностику»**. Ожидается блок из трёх задач в порядке
   easy, medium, hard. Ни reference solution, ни скрытые тесты в DevTools
   Network отсутствуют.
3. В первой задаче введите `print(`. Ожидается `syntax_error`, следующая задача
   остаётся заблокированной.
4. Введите `raise RuntimeError('check')`. Ожидается `runtime_error` и увеличение
   номера попытки.
5. Введите `while True: pass`. Ожидается `timeout` (в пределах sandbox timeout).
6. Введите корректную программу для показанного условия, читающую stdin и
   печатающую требуемый stdout. Ожидается `passed`; кнопка перехода разблокируется.
7. Измените один символ принятого кода. Success исчезает, переход снова
   блокируется. Верните корректный вариант, повторно проверьте и пройдите medium
   и hard тем же способом.
8. После hard нажмите **«Перейти к вопросам»**. Ожидаются вопросы, относящиеся к
   фактическим трём решениям. Пустые ответы не принимаются.
9. Ответьте на каждый вопрос и продолжите. Ожидаются профиль, карточки реального
   `UnderstandingAssessment` и кнопка построения roadmap.
10. Нажмите **«Построить roadmap»**. Ожидаются шаги и рекомендации, возвращённые
    backend, без захардкоженных тем frontend.

## Ограничения PoC

- Сессии находятся только в памяти одного процесса и теряются после рестарта;
  аутентификации, БД и горизонтального масштабирования пока нет.
- AI и Docker вызываются синхронно; для production понадобятся очередь задач,
  персистентность и лимиты на пользователя.
- ZEROK-5 пока не предоставляет отдельную каноническую модель для ответа на
  `SolutionQuestion` и его семантического score. Текстовые объяснения влияют на
  наблюдения ZEROK-6, но сам `UnderstandingAssessment` остаётся детерминированным
  результатом существующего ZEROK-5.
- Полный живой smoke-test зависит от внешнего DeepSeek и локального Docker.
