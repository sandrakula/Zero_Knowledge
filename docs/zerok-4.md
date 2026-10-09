# ZEROK-4: генерация и проверка блока Python-задач

Модуль `zero_knowledge.task_generation` генерирует блок из трёх задач в
порядке `easy`, `medium`, `hard`, валидирует канонические сущности ZEROK-2 и
передаёт эталонный код с тестами в изолированный runner ZEROK-3.

## Точка входа

```python
from zero_knowledge.task_generation import TaskBlockService

service = TaskBlockService(provider, runner, max_attempts=3)
task_set, tasks, solutions, tests = service.generate()
```

Результат состоит только из существующих моделей ZEROK-2: `TaskSet`, `Task`,
`ReferenceSolution`, `TestCase`. Дополнительная доменная схема блока не
создавалась. JSON-ответ AI использует транспортный объект с тремя массивами:
`tasks`, `solutions`, `tests`; элементы массивов строго валидируются самими
схемами ZEROK-2, а связи проверяются по UUID.

## Интеграции

- `TaskGenerationProvider.generate(prompt) -> str` — минимальная граница для
  ZEROK-1. Фактический `zero_knowledge.llm.DeepSeekClient` уже реализует этот
  протокол напрямую, поэтому дополнительный adapter не нужен. Клиент возвращает
  JSON-текст и преобразует timeout/auth/network ошибки в
  `ProviderUnavailableError`.
- `IsolatedExecutionRunner.verify_reference(task, solution, tests) -> None` —
  минимальная граница для ZEROK-3. Успешный возврат допустим только после
  реального изолированного запуска всех тестов. Несовпадение результата —
  `ReferenceSolutionFailedError`, недоступность runner —
  `IsolatedExecutionUnavailableError`. Фактический
  `zero_knowledge.execution.DockerIsolatedExecutionRunner` напрямую реализует
  этот протокол, поэтому второй sandbox или adapter не создавались.

Для неподключённых интеграций доступны явные заглушки
`UnavailableTaskGenerationProvider` и `UnavailableExecutionRunner`. Они ничего
не генерируют и не исполняют. Runner-заглушка всегда возвращает ошибку
`ReferenceNotExecutedError`, поэтому stub/mock никогда не выдаётся за успешную
проверку безопасности или корректности.

`TaskBlockService.generate_without_reference_execution()` позволяет получить
реальный DeepSeek-ответ после полной ZEROK-2 валидации. Он намеренно не вызывает
runner и возвращает отдельный `UnverifiedTaskBlock` со статусами
`generation=success`, `schema_validation=success`,
`reference_execution=not_run`. Обычный `generate()` сохраняет прежний строгий
контракт: успешный возврат возможен только после проверки реальным runner.

## Ручной DeepSeek demo

```powershell
uv pip install --python .\.venv\Scripts\python.exe -e ".[dev]"
docker build -t zero-knowledge/sandbox:latest infra/sandbox
$env:DEEPSEEK_API_KEY = "..."
.\.venv\Scripts\python.exe scripts\demo_task_generation.py
```

По умолчанию demo использует строгий `generate()`: печатает три задачи,
эталонный код, тесты, число пройденных тестов и `TaskSet status: VERIFIED`
только после успешного исполнения всех эталонов через ZEROK-3. Запуск с
`--preview` сохраняет generation-only режим и явно выводит
`Reference execution: NOT RUN`. Настройки перечислены в `.env.example`; `.env`
автоматически не загружается.

## Валидация и повторы

Проверяются JSON и схемы, ровно три задачи, порядок и уникальность сложностей,
тип `programming`, `metadata.language="python"`, непустые условие и эталонный
код, наличие тестов, уникальность UUID и порядков тестов, а также все связи
`Task` → `ReferenceSolution`/`TestCase`.

`max_attempts` задаётся в конструкторе и по умолчанию равен 3. Новая генерация
делается только после дефекта структуры/содержания или падения эталона на
тестах. После лимита возникает `AttemptsExhaustedError` с числом попыток и
последней причиной. Недоступность AI или isolated runner — инфраструктурная
ошибка; она возвращается сразу и не расходует лимит на бессмысленные повторные
генерации.

Ожидаемые состояния различаются типами исключений:

- `GeneratedBlockInvalidError` — некорректный ответ или связи;
- `ReferenceSolutionFailedError` — эталон провалил реальный запуск;
- `AttemptsExhaustedError` — закончились попытки исправить контент;
- `ProviderUnavailableError` — недоступен ZEROK-1/provider;
- `IsolatedExecutionUnavailableError` — недоступен ZEROK-3;
- `ReferenceNotExecutedError` — настроена только неисполняющая заглушка.

ZEROK-3 трактует несовпадение вывода, ненулевой exit code (включая
`ZeroDivisionError`, `IndexError`, `SyntaxError` и `MemoryError`) и timeout
эталона как содержательную ошибку генерации. Недоступный Docker CLI/daemon или
образ — инфраструктурная ошибка без повторного запроса к DeepSeek. Сообщение о
runtime error ограничивается коротким stderr; полный внутренний traceback demo
не печатает.

## Границы гарантий

Автоматические проверки подтверждают структуру данных, согласованность ссылок и,
при подключённом ZEROK-3, фактический результат эталонного кода на переданных
тестах. Они не оценивают педагогическое качество и не доказывают, что текст
условия соответствует намерению автора.

**Прохождение эталонного решения по сгенерированным тестам подтверждает только
согласованность эталона с данным набором тестов и не доказывает семантическую
корректность условия задачи.**
