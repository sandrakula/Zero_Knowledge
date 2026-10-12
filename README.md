# Zero Knowledge

Zero Knowledge — интеллектуальная образовательная платформа для диагностики знаний через практические задачи и обсуждение решений с AI. Проект предусматривает профиль знаний пользователя, персональный образовательный путь и обучение непосредственно на платформе.

## Статус

Подготовка Proof of Concept (PoC).

Дата демонстрации: **14 октября 2026 года**.

## Структура файлов

```text
.
├── docs/
│   └── project_spec.md  # место для требований из исходного документа команды
├── .env.example         # шаблон переменных окружения без секретов
├── .gitignore           # исключения для Python, IDE и локальных секретов
└── README.md            # описание проекта и правила совместной работы
```

Модуль генерации и проверки трёх Python-задач (ZEROK-4) описан в
[`docs/zerok-4.md`](docs/zerok-4.md). Он напрямую использует DeepSeek-клиент
ZEROK-1, валидирует ответ схемами ZEROK-2 и выполняет эталоны через Docker-runner
ZEROK-3, описанный в [`docs/zerok-3.md`](docs/zerok-3.md).

Полный demo через DeepSeek и реальную песочницу (ключ читается из
`DEEPSEEK_API_KEY`):

```powershell
uv pip install --python .\.venv\Scripts\python.exe -e ".[dev]"
docker build -t zero-knowledge/sandbox:latest infra/sandbox
.\.venv\Scripts\python.exe scripts\demo_task_generation.py
```

Режим `--preview` выполняет генерацию и ZEROK-2 validation, но намеренно не
исполняет эталонный код и помечает результат как `UNVERIFIED`.

Endpoint, модель, таймаут, retries и лимиты песочницы настраиваются переменными из
`.env.example`. Сам файл `.env` не загружается автоматически и исключён из Git;
переменные нужно передать процессу через окружение.

## Веб-интерфейс (ZEROK-7)

Сквозной браузерный PoC использует DeepSeek только на backend и исполняет
решения в Docker:

```powershell
docker build -t zero-knowledge/sandbox:latest infra/sandbox
$env:DEEPSEEK_API_KEY = "ваш-ключ"
.\.venv\Scripts\python.exe -m zero_knowledge.web_app --host 127.0.0.1 --port 8000
```

После запуска откройте <http://127.0.0.1:8000/>. Архитектура, API, переменные
окружения, smoke-test и ограничения PoC описаны в
[`docs/zerok-7.md`](docs/zerok-7.md).

## Правила совместной работы

- Для каждой задачи создаётся отдельная ветка.
- Изменения объединяются через Pull Request.
- Рабочая версия проекта всегда находится в ветке `main`.
