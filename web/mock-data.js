/**
 * Заглушка границы данных ZEROK-7.
 *
 * Объекты сохраняют названия полей Pydantic-схем из zero_knowledge.schemas.
 * В ZEROK-8 этот модуль заменяется API-адаптером с теми же методами. Ниже нет
 * обещаний о будущих HTTP-маршрутах: они ещё не согласованы.
 */

const defaultWait = (ms = 650) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));

const taskIds = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

const tasks = [
  {
    id: taskIds[0],
    title: "Сумма положительных чисел",
    discipline: "programming",
    task_type: "programming",
    statement: "Напишите функцию sum_positive(numbers), которая возвращает сумму только положительных чисел списка. Ноль и отрицательные числа не учитываются.",
    difficulty: "easy",
    cognitive_depth: "application",
    topic_ids: ["python.collections", "python.conditions"],
    tags: ["python", "list", "function"],
    prerequisites: ["python.functions"],
    is_transfer: false,
    is_project: false,
    allowed_attempts: null,
    time_limit_seconds: null,
    hint_ids: [],
    solution_id: "11111111-aaaa-4111-8111-111111111111",
    test_ids: ["11111111-bbbb-4111-8111-111111111111", "11111111-cccc-4111-8111-111111111111"],
    metadata: { language: "python", function_name: "sum_positive" },
  },
  {
    id: taskIds[1],
    title: "Первый неповторяющийся символ",
    discipline: "algorithms",
    task_type: "programming",
    statement: "Напишите функцию first_unique(text), которая возвращает первый символ, встречающийся в строке ровно один раз. Если такого символа нет, верните None. Регистр важен.",
    difficulty: "medium",
    cognitive_depth: "analysis",
    topic_ids: ["python.dictionaries", "algorithms.counting"],
    tags: ["python", "dict", "string"],
    prerequisites: ["python.collections", "python.loops"],
    is_transfer: false,
    is_project: false,
    allowed_attempts: null,
    time_limit_seconds: null,
    hint_ids: [],
    solution_id: "22222222-aaaa-4222-8222-222222222222",
    test_ids: ["22222222-bbbb-4222-8222-222222222222", "22222222-cccc-4222-8222-222222222222"],
    metadata: { language: "python", function_name: "first_unique" },
  },
  {
    id: taskIds[2],
    title: "Объединение интервалов",
    discipline: "algorithms",
    task_type: "programming",
    statement: "Напишите функцию merge_intervals(intervals). Она получает список пар [start, end], объединяет пересекающиеся интервалы и возвращает результат по возрастанию start. Соприкасающиеся границами интервалы тоже объединяются.",
    difficulty: "hard",
    cognitive_depth: "analysis",
    topic_ids: ["algorithms.sorting", "algorithms.intervals"],
    tags: ["python", "sorting", "intervals"],
    prerequisites: ["python.collections", "algorithms.sorting"],
    is_transfer: true,
    is_project: false,
    allowed_attempts: null,
    time_limit_seconds: null,
    hint_ids: [],
    solution_id: "33333333-aaaa-4333-8333-333333333333",
    test_ids: ["33333333-bbbb-4333-8333-333333333333", "33333333-cccc-4333-8333-333333333333"],
    metadata: { language: "python", function_name: "merge_intervals" },
  },
];

// Представление не смешивается с Task: эти поля не входят в Pydantic-схему.
const taskPresentation = {
  [taskIds[0]]: {
    examples: [
      { input_data: "[3, -1, 0, 5]", expected_output: "8" },
      { input_data: "[-4, -2]", expected_output: "0" },
    ],
    starterCode: "def sum_positive(numbers):\n    # Напишите решение\n    pass",
    fixtures: [
      { id: "passed", label: "Корректный образец", description: "Известный заглушке успешный исход", code: "def sum_positive(numbers):\n    return sum(number for number in numbers if number > 0)" },
      { id: "failed", label: "Неверный результат", description: "Подготовленное несовпадение вывода", code: "def sum_positive(numbers):\n    return sum(numbers)" },
      { id: "syntax_error", label: "Синтаксическая ошибка", description: "Подготовленная ошибка SyntaxError", code: "def sum_positive(numbers)\n    return sum(numbers)" },
      { id: "execution_error", label: "Ошибка выполнения", description: "Подготовленная ошибка RuntimeError", code: "def sum_positive(numbers):\n    raise RuntimeError(\"demo\")" },
    ],
  },
  [taskIds[1]]: {
    examples: [
      { input_data: "'swiss'", expected_output: "'w'" },
      { input_data: "'aabb'", expected_output: "None" },
    ],
    starterCode: "def first_unique(text):\n    # Напишите решение\n    pass",
    fixtures: [
      { id: "passed", label: "Корректный образец", description: "Известный заглушке успешный исход", code: "def first_unique(text):\n    counts = {}\n    for char in text:\n        counts[char] = counts.get(char, 0) + 1\n    for char in text:\n        if counts[char] == 1:\n            return char\n    return None" },
      { id: "failed", label: "Неверный результат", description: "Подготовленное несовпадение вывода", code: "def first_unique(text):\n    return text[0] if text else None" },
      { id: "syntax_error", label: "Синтаксическая ошибка", description: "Подготовленная ошибка SyntaxError", code: "def first_unique(text)\n    return None" },
      { id: "execution_error", label: "Ошибка выполнения", description: "Подготовленная ошибка IndexError", code: "def first_unique(text):\n    return text[len(text)]" },
    ],
  },
  [taskIds[2]]: {
    examples: [
      { input_data: "[[1, 3], [2, 6], [8, 10]]", expected_output: "[[1, 6], [8, 10]]" },
      { input_data: "[[1, 2], [2, 4]]", expected_output: "[[1, 4]]" },
    ],
    starterCode: "def merge_intervals(intervals):\n    # Напишите решение\n    pass",
    fixtures: [
      { id: "passed", label: "Корректный образец", description: "Известный заглушке успешный исход", code: "def merge_intervals(intervals):\n    sorted_intervals = sorted(intervals)\n    merged = []\n    for start, end in sorted_intervals:\n        if not merged or start > merged[-1][1]:\n            merged.append([start, end])\n        else:\n            merged[-1][1] = max(merged[-1][1], end)\n    return merged" },
      { id: "failed", label: "Неверный результат", description: "Подготовленное несовпадение вывода", code: "def merge_intervals(intervals):\n    return sorted(intervals)" },
      { id: "syntax_error", label: "Синтаксическая ошибка", description: "Подготовленная ошибка SyntaxError", code: "def merge_intervals(intervals)\n    return intervals" },
      { id: "execution_error", label: "Ошибка выполнения", description: "Подготовленная ошибка TypeError", code: "def merge_intervals(intervals):\n    return intervals + None" },
    ],
  },
};

const profile = {
  id: "55555555-5555-4555-8555-555555555555",
  student_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  skills: {
    "python.collections": { skill_id: "python.collections", mastery: "proficient", cognitive_depth: "application", independence: 0.78, application: 0.74, transfer: 0.61, retention: 0.72, process_quality: 0.76, calibration: 0.08, evidence_count: 3 },
    "algorithms.complexity": { skill_id: "algorithms.complexity", mastery: "developing", cognitive_depth: "comprehension", independence: 0.52, application: 0.46, transfer: 0.4, retention: 0.58, process_quality: 0.55, calibration: -0.12, evidence_count: 2 },
    "algorithms.intervals": { skill_id: "algorithms.intervals", mastery: "novice", cognitive_depth: "recognition", independence: 0.36, application: 0.32, transfer: 0.28, retention: 0.44, process_quality: 0.41, calibration: 0.02, evidence_count: 1 },
  },
  misconceptions: [],
  strengths: ["python.collections"],
  weaknesses: ["algorithms.intervals"],
  needs_review: ["algorithms.complexity", "algorithms.intervals"],
};

const roadmap = {
  id: "66666666-6666-4666-8666-666666666666",
  student_id: profile.student_id,
  goal: "Уверенно решать базовые алгоритмические задачи на Python",
  goal_status: "planned",
  based_on_profile_id: profile.id,
  version: 1,
  steps: [
    { id: "77777777-7777-4777-8777-777777777771", order: 0, step_type: "review", title: "Сложность алгоритмов", description: "Повторить O(n), O(n log n) и влияние сортировки.", skill_ids: ["algorithms.complexity"], difficulty: "easy", task_ids: [], status: "pending", rationale: "Это поможет осознанно сравнивать решения." },
    { id: "77777777-7777-4777-8777-777777777772", order: 1, step_type: "study", title: "Паттерн интервалов", description: "Разобрать сортировку и последовательное слияние диапазонов.", skill_ids: ["algorithms.intervals"], difficulty: "medium", task_ids: [], status: "pending", rationale: "В демонстрационном профиле этот навык требует развития." },
    { id: "77777777-7777-4777-8777-777777777773", order: 2, step_type: "practice", title: "Практика со структурами данных", description: "Решить две задачи на словари и множества.", skill_ids: ["python.collections"], difficulty: "medium", task_ids: [], status: "pending", rationale: "Практика закрепит уже заметную сильную сторону." },
    { id: "77777777-7777-4777-8777-777777777774", order: 3, step_type: "transfer", title: "Задача на перенос", description: "Применить объединение интервалов к расписанию встреч.", skill_ids: ["algorithms.intervals"], difficulty: "hard", task_ids: [], status: "pending", rationale: "Новый контекст проверит перенос подхода." },
  ],
  recommendations: [
    { action: "Начать со сложности алгоритмов", rationale: "Так будет проще объяснять стоимость каждого решения.", skill_ids: ["algorithms.complexity"] },
  ],
};

const reviewQuestions = {
  [taskIds[0]]: [
    { order: 0, kind: "strategy", text: "Почему в генераторном выражении используется условие number > 0?", target: "number > 0", rationale: "Проверить понимание фильтрации положительных значений." },
    { order: 1, kind: "transfer", text: "Как изменится это генераторное выражение, если нужно суммировать только чётные положительные числа?", target: "generator expression", rationale: "Проверить перенос выбранного способа фильтрации." },
  ],
  [taskIds[1]]: [
    { order: 0, kind: "strategy", text: "Зачем решение сначала заполняет словарь counts, а затем проходит по text второй раз?", target: "counts", rationale: "Проверить понимание двух проходов и сохранения порядка строки." },
    { order: 1, kind: "explanation", text: "Почему выражение counts.get(char, 0) безопасно для символа, которого ещё нет в словаре?", target: "counts.get(char, 0)", rationale: "Проверить понимание работы словаря в представленном коде." },
  ],
  [taskIds[2]]: [
    { order: 0, kind: "strategy", text: "Почему интервалы сортируются до заполнения списка merged?", target: "sorted_intervals", rationale: "Проверить роль сортировки в выбранном алгоритме." },
    { order: 1, kind: "understanding", text: "Что означает проверка start > merged[-1][1] именно в вашем цикле?", target: "start > merged[-1][1]", rationale: "Проверить понимание условия начала нового интервала." },
  ],
};

function normalizedCode(value) {
  return value.replace(/\r\n/g, "\n").trim();
}

function initialTransportMode() {
  if (typeof window === "undefined") return "normal";
  const query = new URLSearchParams(window.location.search);
  return query.get("transport") === "network-error" || query.get("mock") === "network-error"
    ? "network-error"
    : "normal";
}

function answerId(taskId, attemptNumber) {
  const prefix = taskId.slice(0, 8);
  return `${prefix}-eeee-4eee-8eee-${String(attemptNumber).padStart(12, "0")}`;
}

function makeAnswer(draft, fixtureId) {
  const isCorrect = fixtureId === "passed" ? true : fixtureId === "failed" || fixtureId.endsWith("error") ? false : null;
  const status = isCorrect === true ? "correct" : isCorrect === false ? "incorrect" : "pending";
  return {
    id: answerId(draft.task_id, draft.attempt_number),
    ...draft,
    status,
    is_correct: isCorrect,
    score: null,
    feedback: null,
    execution_log: null,
  };
}

function makeReview(answer) {
  return {
    id: `${answer.task_id.slice(0, 8)}-dddd-4ddd-8ddd-000000000001`,
    answer_id: answer.id,
    task_id: answer.task_id,
    questions: structuredClone(reviewQuestions[answer.task_id]),
    assessment: {
      is_correct: true,
      independence: 1,
      understanding: "expert",
      hints_used: [],
      rationale: "Ответ: верно. подсказки не использованы. Самостоятельность: 1.00. Понимание: expert.",
    },
  };
}

function evaluateKnownFixture(draft) {
  const presentation = taskPresentation[draft.task_id];
  const fixture = presentation?.fixtures.find((item) => normalizedCode(item.code) === normalizedCode(draft.content));
  const fixtureId = fixture?.id || "unknown";
  const answer = makeAnswer(draft, fixtureId);

  if (fixtureId === "passed") {
    answer.feedback = "Заглушка узнала подготовленный корректный образец.";
    answer.execution_log = "mock fixture: 2 of 2 cases passed";
    return { evaluation: { state: "passed", kind: "known_fixture", message: "Подготовленные тесты пройдены.", details: answer.execution_log }, answer, review: makeReview(answer) };
  }
  if (fixtureId === "failed") {
    answer.feedback = "Подготовленный образец возвращает неверный результат.";
    answer.execution_log = "mock fixture: expected output differs from prepared output";
    return { evaluation: { state: "failed", kind: "output_mismatch", message: "Результат не совпал с ожидаемым.", details: answer.execution_log }, answer, review: null };
  }
  if (fixtureId === "syntax_error") {
    answer.feedback = "Подготовленный образец содержит синтаксическую ошибку.";
    answer.execution_log = "mock fixture: SyntaxError in function declaration";
    return { evaluation: { state: "error", kind: "syntax_error", message: "Интерпретатор не смог разобрать код.", details: answer.execution_log }, answer, review: null };
  }
  if (fixtureId === "execution_error") {
    answer.feedback = "Подготовленный образец завершился ошибкой выполнения.";
    answer.execution_log = `mock fixture: runtime failure in ${presentation ? tasks.find((task) => task.id === draft.task_id).metadata.function_name : "solution"}`;
    return { evaluation: { state: "error", kind: "execution_error", message: "Во время демонстрационного запуска возникло исключение.", details: answer.execution_log }, answer, review: null };
  }

  answer.feedback = "Произвольный код нельзя достоверно проверить без изолированного backend-исполнения ZEROK-8.";
  return {
    evaluation: { state: "not_evaluated", kind: "backend_required", message: "Корректность не определена.", details: "Код сохранён, но не выполнялся и не сравнивался эвристиками." },
    answer,
    review: null,
  };
}

export class MockDiagnosticService {
  constructor({ delay = 650, transportMode = initialTransportMode(), wait = defaultWait } = {}) {
    this.delay = delay;
    this.transportMode = transportMode;
    this.wait = wait;
    this.failedOperations = new Set();
  }

  getTransportMode() {
    return this.transportMode;
  }

  setTransportMode(value) {
    this.transportMode = value;
    this.failedOperations.clear();
  }

  async respond(operation, value) {
    await this.wait(this.delay);
    if (this.transportMode === "network-error" && !this.failedOperations.has(operation)) {
      this.failedOperations.add(operation);
      throw new Error("Демонстрационный сбой загрузки. Данные не были отправлены.");
    }
    return structuredClone(value);
  }

  getDiagnostic() {
    return this.respond("diagnostic", {
      taskSet: {
        id: "99999999-9999-4999-8999-999999999999",
        title: "Диагностика Python",
        purpose: "diagnostic",
        description: "Три задачи возрастающей сложности",
        items: taskIds.map((task_id, order) => ({ task_id, order })),
        time_limit_seconds: null,
      },
      tasks,
      taskPresentation,
    });
  }

  checkAnswer(answerDraft) {
    return this.respond(`check-${answerDraft.task_id}`, evaluateKnownFixture(answerDraft));
  }

  getDiscussion(evaluationResults) {
    const reviews = evaluationResults.map((result) => result?.review);
    if (reviews.some((review) => !review)) {
      throw new Error("Вопросы доступны только после успешной проверки всех трёх подготовленных образцов.");
    }
    return this.respond("discussion", reviews);
  }

  submitExplanations(responses) {
    return this.respond("explanations", { accepted: responses.length });
  }

  getProfile() {
    return this.respond("profile", profile);
  }

  getRoadmap() {
    return this.respond("roadmap", roadmap);
  }
}

export const mockApi = new MockDiagnosticService();
