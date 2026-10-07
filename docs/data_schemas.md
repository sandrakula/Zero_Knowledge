# Схемы данных платформы (Pydantic)

> **Задача:** зафиксировать схемы данных для задачи, ответа, подсказки, эталонного
> решения, теста, профиля знаний и roadmap; согласовать между участниками.
>
> **Критерий готовности:** схемы описаны и согласованы.
> **Зависимости:** нет. **Блокирует:** каркас интерфейса.

Код схем лежит в пакете `zero_knowledge.schemas` (`src/zero_knowledge/schemas/`).
Все модели построены на **Pydantic v2** и следуют единым правилам:

- неизвестные поля отклоняются (`extra="forbid"`), чтобы расхождения контрактов
  обнаруживались на этапе валидации, а не в рантайме;
- все сущности имеют `id: UUID` (`Identified`) и времена `created_at`/`updated_at`
  в UTC (`Timestamped`);
- дискретные значения зафиксированы перечислениями (`str, Enum`) — см. `enums.py`;
- для каждой сущности доступна JSON Schema: `Model.model_json_schema()`.

## 1. Задача — `Task`

Центральная сущность контента. Покрывает и диагностические вопросы, и программные
задачи. Связанные сущности хранятся по идентификаторам.

| Поле | Тип | Описание |
|---|---|---|
| `id` | `UUID` | Идентификатор |
| `title` | `str` (1–200) | Заголовок |
| `discipline` | `Discipline` | Направление (ML, programming, algorithms, …) |
| `task_type` | `TaskType` | Тип задания (question, programming, debugging, …) |
| `statement` | `str` | Условие |
| `difficulty` | `Difficulty` | Сложность (trivial … expert) |
| `cognitive_depth` | `CognitiveDepth` | Глубина понимания по Блуму |
| `topic_ids` | `list[str]` | Связанные темы/навыки |
| `tags` | `list[str]` | Теги для поиска |
| `prerequisites` | `list[str]` | Необходимые предварительные навыки |
| `is_transfer` | `bool` | Задача на перенос (п. 15) |
| `is_project` | `bool` | Относится к комплексному проекту (п. 22) |
| `allowed_attempts` | `int \| None` | Лимит попыток |
| `time_limit_seconds` | `int \| None` | Лимит времени |
| `hint_ids` | `list[UUID]` | Доступные подсказки |
| `solution_id` | `UUID \| None` | Эталонное решение |
| `test_ids` | `list[UUID]` | Тест-кейсы (для программных задач) |
| `metadata` | `dict[str, Any]` | Расширяемые метаданные |

## 2. Ответ — `Answer`

Фиксирует не только содержание, но и процесс решения: номер попытки,
использованные подсказки, самооценку уверенности.

| Поле | Тип | Описание |
|---|---|---|
| `task_id` | `UUID` | Задача |
| `student_id` | `UUID` | Студент |
| `attempt_number` | `int` (≥1) | Номер попытки |
| `format` | `AnswerFormat` | Формат (text, code, choice, numeric, explanation) |
| `content` | `str` | Содержимое |
| `code_language` | `str \| None` | Язык кода |
| `chosen_options` | `list[str]` | Выбранные варианты |
| `used_hint_ids` | `list[UUID]` | Использованные подсказки |
| `confidence` | `ConfidenceLevel \| None` | Самооценка уверенности (п. 19) |
| `status` | `AnswerStatus` | Статус проверки (pending/correct/…) |
| `is_correct` | `bool \| None` | Итоговая корректность |
| `score` | `float \| None` (0..1) | Нормализованная оценка |
| `feedback` | `str \| None` | Обратная связь |
| `execution_log` | `str \| None` | Лог выполнения (код) |

> Инвариант: `content` и `chosen_options` не могут быть пустыми одновременно.

## 3. Подсказка — `Hint`

| Поле | Тип | Описание |
|---|---|---|
| `task_id` | `UUID` | Задача |
| `level` | `HintLevel` | Уровень (nudge → question → direction → idea → step → full_explanation) |
| `order` | `int` | Порядок показа |
| `content` | `str` | Текст |
| `reveals_solution` | `bool` | Раскрывает ли решение целиком |
| `independence_penalty` | `float` (0..1) | Штраф к самостоятельности за использование |

## 4. Эталонное решение — `ReferenceSolution`

| Поле | Тип | Описание |
|---|---|---|
| `task_id` | `UUID` | Задача |
| `approach` | `str` | Подход/стратегия |
| `steps` | `list[SolutionStep]` | Пошаговое решение |
| `final_answer` | `str` | Итоговый ответ |
| `code` | `str \| None` | Эталонный код |
| `complexity` | `str \| None` | Сложность, напр. «O(n log n)» |
| `alternative_approaches` | `list[str]` | Альтернативные подходы |
| `explanation` | `str` | Разбор типичных ошибок |

`SolutionStep`: `order`, `title`, `explanation`, `code?`.

## 5. Тест

В платформе «тест» встречается в двух смыслах; покрыты оба.

### 5.1. `TestCase` — тест-кейс для автоматической проверки кода (п. 11)

| Поле | Тип | Описание |
|---|---|---|
| `task_id` | `UUID` | Задача |
| `description` | `str` | Описание случая |
| `input_data` | `str` | Входные данные |
| `expected_output` | `str` | Ожидаемый вывод |
| `is_hidden` | `bool` | Скрыт ли от студента (по умолчанию `true`) |
| `order` | `int` | Порядок выполнения |
| `timeout_ms` | `int \| None` | Лимит времени, мс |
| `memory_mb` | `int \| None` | Лимит памяти, МБ |

### 5.2. `TaskSet` — диагностический/проверочный тест (п. 5)

Упорядоченный набор задач: `title`, `purpose` (`TaskSetPurpose`),
`items: list[TaskSetItem]` (`task_id` + `order`), `time_limit_seconds?`.

## 6. Профиль знаний — `KnowledgeProfile`

Постоянно обновляемая модель компетенций студента.

| Поле | Тип | Описание |
|---|---|---|
| `student_id` | `UUID` | Студент |
| `skills` | `dict[str, SkillAssessment]` | Карта навыков `skill_id → оценка` |
| `misconceptions` | `list[Misconception]` | Устойчивые заблуждения |
| `strengths` | `list[str]` | Сильные стороны |
| `weaknesses` | `list[str]` | Слабые места |
| `needs_review` | `list[str]` | Темы для повторения |

### 6.1. `SkillAssessment` — восемь измерений компетентности (п. 25)

| Измерение | Поле | Тип |
|---|---|---|
| mastery | `mastery` | `MasteryLevel` |
| cognitive depth | `cognitive_depth` | `CognitiveDepth` |
| independence | `independence` | `float` 0..1 |
| application/integration | `application` | `float` 0..1 |
| transfer | `transfer` | `float` 0..1 |
| retention | `retention` | `float` 0..1 |
| process/strategy | `process_quality` | `float` 0..1 |
| калибровка самооценки | `calibration` | `float` -1..1 |

Плюс `evidence_count` (число наблюдений) и `last_assessed_at`.

### 6.2. `Misconception` — устойчивое заблуждение (п. 9)

`student_id`, `skill_id`, `description`, `cause` (`MisconceptionCause` — одна из
8 причин ошибки), `status` (`MisconceptionStatus`), `occurrences`,
`created_at` (момент обнаружения), `resolved_at?`.

## 7. Roadmap — `Roadmap`

Персональный путь обучения, формируемый после диагностики.

| Поле | Тип | Описание |
|---|---|---|
| `student_id` | `UUID` | Студент |
| `goal` | `str` | Цель обучения (п. 27) |
| `goal_status` | `LearningGoalStatus` | Статус цели |
| `based_on_profile_id` | `UUID \| None` | Профиль, на основе которого построен план |
| `steps` | `list[RoadmapStep]` | Упорядоченные шаги |
| `recommendations` | `list[Recommendation]` | Объяснимые рекомендации (п. 21) |
| `version` | `int` (≥1) | Версия плана, растёт при пересмотре |

`RoadmapStep`: `id`, `order`, `step_type` (`RoadmapStepType`), `title`,
`description`, `skill_ids`, `difficulty`, `task_ids`, `status`
(`RoadmapStepStatus`), `rationale`.

`Recommendation`: `action`, `rationale` (объяснение «почему»), `skill_ids`.

## Связи между сущностями

```text
Task ──hint_ids──▶ Hint
Task ──solution_id──▶ ReferenceSolution
Task ──test_ids──▶ TestCase
Answer ──task_id──▶ Task
Answer ──used_hint_ids──▶ Hint
TaskSet ──items──▶ Task
KnowledgeProfile.student_id ──▶ Student
Roadmap.student_id ──▶ Student
Roadmap.based_on_profile_id ──▶ KnowledgeProfile
```

## Согласование

| Участник | Статус | Дата |
|---|---|---|
| — (ожидает ревью команды) | ⏳ | — |

Замечания и правки фиксируются в комментариях к Pull Request. После согласования
этот раздел заполняется и схемы считаются утверждёнными.
