/**
 * Заглушка границы данных ZEROK-7.
 *
 * Объекты сохраняют названия полей Pydantic-схем из zero_knowledge.schemas.
 * В ZEROK-8 этот модуль заменяется API-адаптером с теми же методами. Ниже нет
 * обещаний о будущих HTTP-маршрутах: они ещё не согласованы.
 */

const wait = (ms = 650) => new Promise((resolve) => window.setTimeout(resolve, ms));

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
  },
  [taskIds[1]]: {
    examples: [
      { input_data: "'swiss'", expected_output: "'w'" },
      { input_data: "'aabb'", expected_output: "None" },
    ],
    starterCode: "def first_unique(text):\n    # Напишите решение\n    pass",
  },
  [taskIds[2]]: {
    examples: [
      { input_data: "[[1, 3], [2, 6], [8, 10]]", expected_output: "[[1, 6], [8, 10]]" },
      { input_data: "[[1, 2], [2, 4]]", expected_output: "[[1, 4]]" },
    ],
    starterCode: "def merge_intervals(intervals):\n    # Напишите решение\n    pass",
  },
};

const discussionTasks = [
  {
    id: "44444444-4444-4444-8444-444444444441",
    title: "Выбор структуры данных",
    discipline: "programming",
    task_type: "explanation",
    statement: "Почему для поиска первого неповторяющегося символа удобно сначала посчитать частоты в словаре?",
    difficulty: "medium",
    cognitive_depth: "evaluation",
    topic_ids: ["python.dictionaries", "algorithms.counting"],
  },
  {
    id: "44444444-4444-4444-8444-444444444442",
    title: "Оценка сложности",
    discipline: "algorithms",
    task_type: "explanation",
    statement: "Какова временная сложность вашего подхода к объединению интервалов и какая операция определяет её?",
    difficulty: "hard",
    cognitive_depth: "analysis",
    topic_ids: ["algorithms.complexity", "algorithms.sorting"],
  },
  {
    id: "44444444-4444-4444-8444-444444444443",
    title: "Граничный случай",
    discipline: "programming",
    task_type: "explanation",
    statement: "Как ваши функции поведут себя на пустом вводе? Объясните ожидаемый результат.",
    difficulty: "easy",
    cognitive_depth: "comprehension",
    topic_ids: ["python.edge_cases"],
  },
];

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

let scenario = new URLSearchParams(window.location.search).get("mock") || "success";
if (!['success', 'incorrect', 'network-error'].includes(scenario)) scenario = 'success';
const failedOperations = new Set();

async function respond(operation, value) {
  await wait();
  if (scenario === "network-error" && !failedOperations.has(operation)) {
    failedOperations.add(operation);
    throw new Error("Демонстрационный сбой загрузки. Данные не были отправлены.");
  }
  return structuredClone(value);
}

export const mockApi = {
  getScenario: () => scenario,
  setScenario(value) {
    scenario = value;
    failedOperations.clear();
  },
  getDiagnostic() {
    return respond("diagnostic", {
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
  },
  checkAnswer(answer) {
    const incorrect = scenario === "incorrect";
    return respond(`check-${answer.task_id}`, {
      ...answer,
      status: incorrect ? "incorrect" : "correct",
      is_correct: !incorrect,
      score: null,
      feedback: incorrect
        ? "Демонстрация ошибки: один из подготовленных тестов не пройден. Измените сценарий заглушки или код и повторите."
        : "Демонстрация успеха: подготовленные тесты отмечены как пройденные.",
      execution_log: incorrect ? "mock: expected value differs from received value" : "mock: 2 of 2 prepared cases passed",
    });
  },
  getDiscussion() {
    return respond("discussion", discussionTasks);
  },
  submitExplanations(answers) {
    return respond("explanations", { accepted: answers.length });
  },
  getProfile() {
    return respond("profile", profile);
  },
  getRoadmap() {
    return respond("roadmap", roadmap);
  },
};
