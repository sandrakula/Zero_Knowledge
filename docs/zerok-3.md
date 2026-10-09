# ZEROK-3: изолированное исполнение кода в Docker

Модуль `zero_knowledge.execution` запускает произвольный (непроверенный)
Python-код в изолированной Docker-песочнице. Один механизм обслуживает два
сценария:

1. **код пользователя** — выполнение решения студента;
2. **эталонные решения/тесты** — валидация сгенерированных задач в ZEROK-4
   перед выдачей (граница `IsolatedExecutionRunner`).

## Точка входа

```python
from zero_knowledge.execution import (
    DockerIsolatedExecutionRunner,
    DockerSandbox,
)

# 1. Произвольный код (пользовательский сценарий)
sandbox = DockerSandbox()
result = sandbox.execute("print(int(input()) + 1)", input_data="41\n")
result.exit_code, result.stdout, result.timed_out, result.duration_ms

# 2. Валидация эталонного решения (граница ZEROK-4)
runner = DockerIsolatedExecutionRunner()
runner.verify_reference(task, solution, tests)  # None либо typed error
```

`DockerSandbox.execute(...)` возвращает `CodeExecutionResult`
(`exit_code`, `stdout`, `stderr`, `timed_out`, `duration_ms`). Инфраструктурные
сбои (нет `docker`, демон недоступен, образ не найден) поднимают
`SandboxUnavailableError`; всё, что происходит внутри контейнера, — это
обычный результат.

`DockerIsolatedExecutionRunner.verify_reference(...)` реализует протокол
`IsolatedExecutionRunner` из `zero_knowledge.task_generation.ports`:

- успешный возврат означает, что эталон реально исполнен в изоляции и прошёл
  все переданные тест-кейсы;
- `ReferenceSolutionFailedError` — содержательная неудача (неверный вывод,
  ненулевой код, таймаут);
- `IsolatedExecutionUnavailableError` — песочница недоступна (инфраструктура).

## Изоляция

Защита обеспечивается самими ограничениями контейнера, а таймаут — лишь
дополнение, добивающее зависший код:

| Угроза | Механизм |
|---|---|
| запуск от root | `USER sandbox` + `--user 10001:10001` |
| доступ к сети | `--network none` |
| запись в ФС | `--read-only` + read-only bind mount `/work`; писать можно только в изолированный `--tmpfs /tmp` |
| повышение привилегий | `--cap-drop ALL`, `--security-opt no-new-privileges` |
| утечка host-файлов | монтируется только один каталог с кодом; `/tmp` — отдельный tmpfs, host `/tmp` не виден |
| память/CPU/процессы | `--memory`, `--memory-swap` (без swap), `--cpus`, `--pids-limit` |
| зависший код | таймаут на стороне хоста + `docker rm -f` |

## Сборка образа

```powershell
docker build -t zero-knowledge/sandbox:latest infra/sandbox
```

## Настройка

Переменные окружения (см. `.env.example`):

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `ZK_SANDBOX_IMAGE` | `zero-knowledge/sandbox:latest` | Образ песочницы |
| `ZK_SANDBOX_MEMORY` | `128m` | Лимит памяти контейнера |
| `ZK_SANDBOX_CPUS` | `1.0` | Лимит CPU |
| `ZK_SANDBOX_PIDS_LIMIT` | `64` | Лимит числа процессов |
| `ZK_SANDBOX_TMPFS_SIZE` | `16m` | Размер writable `/tmp` |
| `ZK_SANDBOX_TIMEOUT` | `10.0` | Таймаут запуска, сек |
| `ZK_SANDBOX_NETWORK` | `none` | Сеть контейнера (должна оставаться `none`) |
| `ZK_SANDBOX_USER` | `10001:10001` | UID:GID процесса в контейнере |

## Тесты

Интеграционные тесты в `tests/test_execution.py` реально проверяют изоляцию и
пропускаются, если Docker недоступен или образ не удалось собрать:

```powershell
python -m pytest tests/test_execution.py -v
```

Проверяются: корректное исполнение и stdin→stdout, блокировка сети, read-only
ФС, невидимость host-файлов, запуск не от root, таймаут, лимит памяти,
`verify_reference` для верного/неверного/падающего эталона и сквозная
интеграция с `TaskBlockService` (ZEROK-4).

## Границы гарантий и известные ограничения

- Сравнение вывода эталона с ожидаемым нормализует CRLF→LF и срезает хвостовые
  пробелы — это допущение PoC, содержательные отличия внутри вывода считаются
  ошибкой.
- Вывод процесса читается целиком и затем обрезается до 256 КБ на поток; по-
  настоящему ограничить бесконечный вывод на стороне хоста — отдельная
  доработка (bounded reader), сейчас от «chatty» кода защищает только память
  контейнера и таймаут.
- Песочница рассчитана на Python; добавление других языков — расширение образа
  и интерфейса.
