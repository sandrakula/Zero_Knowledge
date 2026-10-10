# Разбор решения: вопросы и оценка понимания

Модуль `zero_knowledge.solution_review` после решения пользователя:

1. **генерирует диагностические вопросы** по решению (через ZEROK-1/AI);
2. **формирует оценку понимания** с учётом правильности ответа и факта/уровня
   использованных подсказок.

## Точка входа

```python
from zero_knowledge.llm import DeepSeekClient
from zero_knowledge.solution_review import SolutionReviewService

service = SolutionReviewService(DeepSeekClient(), max_attempts=3)
review = service.review(task, answer, hints)   # SolutionReview
```

`review.questions` — список `SolutionQuestion` (AI), `review.assessment` —
`UnderstandingAssessment` (детерминированная оценка).

## Схемы

| Сущность | Назначение |
|---|---|
| `SolutionQuestion` | Один вопрос к решению: `order`, `kind`, `text`, `target`, `rationale` |
| `SolutionQuestionnaire` | Набор вопросов к одному `answer_id` |
| `HintUsage` | Факт использования подсказки: `hint_id`, `level`, `independence_penalty` |
| `UnderstandingAssessment` | `is_correct`, `independence`, `understanding`, `hints_used`, `rationale` |
| `SolutionReview` | Итог: `questions` + `assessment` (идентифицированная, с таймстемпами) |

Типы вопросов (`SolutionQuestionKind`): `understanding`, `error_detection`,
`strategy`, `transfer`, `explanation`, `calibration`.

## Оценка понимания (детерминированная)

Оценка не зависит от AI и вычисляется из двух сигналов (п. 25–26
спецификации):

```text
independence = clamp(1 − Σ independence_penalty(подсказки), 0, 1)
```

Уровень `understanding` (`MasteryLevel`):

| Условие | Уровень |
|---|---|
| корректность неизвестна (`is_correct is None`) | `unknown` |
| ответ неверный | `novice` |
| верный, `independence ≥ 0.95` | `expert` |
| верный, `independence ≥ 0.8` | `proficient` |
| верный, `independence ≥ 0.4` | `developing` |
| верный, `independence < 0.4` | `novice` (решил только с подсказками) |

Ключевой сценарий: **верный ответ с полными подсказками не равен
самостоятельному владению** — независимость падает, и уровень снижается.

## Обработка ошибок

- Вопросы генерирует провайдер `SolutionQuestionProvider.generate(prompt) -> str`;
  `DeepSeekClient` удовлетворяет этому протоколу напрямую.
- Содержательные дефекты (невалидный JSON, нарушение схемы вопросов) →
  `QuestionsInvalidError`, расходуют попытку `max_attempts`.
- Недоступность провайдера (auth/timeout/сеть/5xx) → `ProviderUnavailableError`,
  разбор останавливается сразу (повторная генерация инфраструктуру не чинит).
- Исчерпание попыток → `SolutionReviewAttemptsExhaustedError`.

## Гарантии и ограничения

- Оценка понимания полностью детерминирована и проверяема тестами.
- Валидация вопросов подтверждает структуру (типы, перечисления,
  `extra="forbid"`), но не педагогическое качество текста вопросов.
- Пороговые значения независимости (`0.95/0.8/0.4`) — константы модуля
  `scoring.py`; при необходимости выносятся в конфигурацию.

## Запуск

```powershell
# тесты (без сети и ключа)
python -m pytest tests/test_solution_review.py -v

# live-демо (нужен ключ/шлюз)
$env:DEEPSEEK_API_KEY  = "..."
$env:DEEPSEEK_BASE_URL = "https://llm.azati.ai/v1"
python scripts/demo_solution_review.py
```
