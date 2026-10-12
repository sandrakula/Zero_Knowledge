# ZEROK-6: профиль знаний и roadmap

Модуль `zero_knowledge.profile` по итогам диагностики (три задачи, их ответы,
подсказки и оценки понимания) собирает:

1. **профиль знаний** — `KnowledgeProfile` с картой навыков (mastery,
   independence и др.);
2. **короткий roadmap** — `Roadmap` со следующими шагами;
3. **поясняющий текст** — резюме профиля и `rationale` для каждой
   рекомендации генерирует LLM (DeepSeek) — сценарий «объяснимые
   рекомендации».

## Точка входа

```python
from zero_knowledge.llm import DeepSeekClient
from zero_knowledge.profile import ProfileRoadmapService, TaskOutcome

service = ProfileRoadmapService(DeepSeekClient(), max_attempts=3)
result = service.build(student_id, goal, outcomes)

result.profile          # KnowledgeProfile
result.roadmap          # Roadmap (steps + recommendations с rationale)
result.profile_summary  # str — поясняющий текст профиля
```

`outcomes` — список `TaskOutcome(task, answer, hints, assessment)`, где
`assessment` — `UnderstandingAssessment` из модуля разбора решений (ZEROK-5).
Ключ DeepSeek в сервис не передаётся: провайдер (клиент) передаётся готовым,
ключ остаётся на бэкенде.

## Эвристика профиля (детерминированная, без LLM)

Функции `build_profile`, `build_roadmap_steps`, `build_recommendation_drafts`
работают без AI и покрыты тестами.

По каждой задаче берётся самостоятельность и уровень понимания:

- если передан `assessment` (ZEROK-5) — используются его `independence` и
  `understanding`;
- иначе они выводятся из `answer.is_correct` и штрафов `hints` (пороги
  совпадают с `solution_review.scoring`).

Агрегация по навыку (`skill_id` из `task.topic_ids`; при пустом списке —
`task.discipline`):

- `independence` — среднее по задачам навыка;
- `mastery` — самый слабый уровень понимания среди задач навыка
  (консервативно: навык освоен не лучше своего слабого проявления);
- `evidence_count` — число наблюдений;
- `cognitive_depth` — максимальная глубина среди задач навыка.

Классификация:

- `strengths` — mastery `proficient`/`expert` и `independence ≥ 0.8`;
- `weaknesses` — mastery `novice`/`developing` или `independence < 0.4`;
- `needs_review` — mastery `novice`/`developing`.

## Roadmap (детерминированные шаги)

По mastery навыков строятся шаги:

| Состояние навыков | Шаг | Сложность |
|---|---|---|
| `novice`/`unknown` | STUDY «Разобрать основы» | easy |
| `developing` | PRACTICE «Потренировать навыки» | medium |
| `proficient`/`expert` | TRANSFER «Задачи на перенос» | hard |

Рекомендации (action + skill_ids) также детерминированы; LLM дописывает
только `rationale` — почему предложен именно этот шаг.

## LLM-текст

Промпт (`build_explanation_prompt`) передаёт модели цель, профиль, шаги и
черновики рекомендаций. Модель возвращает один JSON-объект:

```json
{
  "profile_summary": "2-4 предложения о профиле",
  "recommendation_rationales": ["почему шаг 1", "почему шаг 2"]
}
```

`recommendation_rationales` должно содержать ровно столько строк, сколько
черновиков рекомендаций. Валидация строгая (`extra="forbid"`, длина списка
сверяется), содержательные дефекты расходуют попытку `max_attempts`.

## Обработка ошибок

- Невалидный JSON / нарушение схемы / неверное число rationale →
  `ExplanationInvalidError`, расходует попытку.
- Недоступность провайдера (auth/timeout/сеть/5xx) → `ProviderUnavailableError`,
  сервис останавливается сразу.
- Исчерпание попыток → `ProfileAttemptsExhaustedError`.
- Если навыков нет (нет данных), LLM не вызывается: возвращается пустой
  roadmap и детерминированное резюме.

## Запуск тестов

```powershell
python -m pytest tests/test_profile.py -v
```

## Границы и ограничения

- `application`/`transfer`/`retention`/`process_quality`/`calibration` в
  `SkillAssessment` пока не заполняются (задача фиксирует mastery и
  independence); `misconceptions` остаётся пустым.
- Эвристика `mastery = самый слабый уровень` консервативна и выбрана для
  простоты и интерпретируемости.
- Качество LLM-текста структурно валидируется, но не оценивается
  педагогически.
