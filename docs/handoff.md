# Handoff — ZEROK-4

Дата: 2026-10-08

- Реализованы парсинг и строгая валидация блока `easy`/`medium`/`hard`, проверка
  UUID-связей ZEROK-2, ограниченные retries и классификация content/infrastructure
  ошибок.
- Добавлены prompt из актуальных JSON Schema, порты интеграции и явные
  неисполняющие заглушки.
- Ключевые файлы: `src/zero_knowledge/task_generation/`,
  `tests/test_task_generation.py`, `docs/zerok-4.md`.
- ZEROK-2 используется без изменений: `Task`, `ReferenceSolution`, `TestCase`,
  `TaskSet`.
- ZEROK-1 отсутствует: ожидается adapter с `generate(prompt) -> str`.
- ZEROK-3 отсутствует: ожидается adapter с `verify_reference(...) -> None`;
  успешный возврат означает реальный изолированный запуск.
- Реальные DeepSeek-вызовы и sandbox-запуски не выполнялись. Заглушка runner
  всегда сообщает `ReferenceNotExecutedError`.
- `.venv\\Scripts\\python.exe -m pytest -vv`: 30 тестов прошли на Python
  3.11.15 (включая 16 сценариев ZEROK-4). Первичный системный `python` 3.10.10
  не подходил требованиям проекта, поэтому создана локальная gitignored `.venv`.
- `ruff check` и `ruff format --check` для новых ZEROK-4 файлов прошли. Полная
  проверка репозитория также нашла 6 прежних замечаний в ZEROK-2 файлах
  (`schemas/__init__.py`, `answer.py`, `common.py`, `test_schemas.py`); они не
  изменялись, чтобы не смешивать задачи.
- Блокер реальной интеграции: ещё не влиты ZEROK-1 и ZEROK-3.
- Следующий шаг: написать тонкие adapters к фактическим интерфейсам коллег и
  прогнать suite в Python >=3.11 с dev-зависимостями.
