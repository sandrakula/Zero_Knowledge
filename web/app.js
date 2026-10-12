import { api } from "./api.js";

const STORAGE_KEY = "zerok-7-session-v3";
const steps = ["Старт", "Задачи", "Вопросы", "Профиль", "Roadmap"];
const difficultyLabels = { trivial: "Базовая", easy: "Лёгкая", medium: "Средняя", hard: "Сложная", expert: "Экспертная" };
const masteryLabels = { unknown: "Не определён", novice: "Начальный", developing: "Развивается", proficient: "Уверенный", expert: "Экспертный" };
const depthLabels = { recognition: "Узнавание", comprehension: "Понимание", application: "Применение", analysis: "Анализ", evaluation: "Оценка", creation: "Создание" };
const kindLabels = { strategy: "Стратегия", transfer: "Перенос", explanation: "Объяснение", understanding: "Понимание", error_detection: "Поиск ошибки", calibration: "Самооценка" };
const stepTypeLabels = { review: "Повторение", study: "Изучение", practice: "Практика", transfer: "Перенос", assessment: "Проверка", project: "Проект" };

const initialState = {
  screen: "welcome", activeTask: 0, diagnostic: null, discussion: null,
  assessments: null, profile: null, profileSummary: null, roadmap: null, codes: {}, checks: {},
  attempts: {}, explanations: {}, loading: null, error: null,
};

let state = loadState();
const app = document.querySelector("#app");
const announcer = document.querySelector("#announcer");
app.addEventListener("click", handleClick);
app.addEventListener("input", handleInput);
app.addEventListener("submit", (event) => {
  if (event.target.id === "questions-form") {
    event.preventDefault();
    submitExplanations();
  }
});
render();

function loadState() {
  try {
    return { ...initialState, ...JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}"), loading: null, error: null };
  } catch {
    return { ...initialState };
  }
}

function persist() {
  const { loading, error, ...stableState } = state;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stableState));
}

function update(patch, options = {}) {
  state = { ...state, ...patch };
  persist();
  render();
  if (options.focusMain) requestAnimationFrame(() => app.focus());
}

function announce(message) {
  announcer.textContent = "";
  requestAnimationFrame(() => { announcer.textContent = message; });
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function currentStep() {
  return { welcome: 0, tasks: 1, questions: 2, profile: 3, roadmap: 4 }[state.screen] ?? 0;
}

function progress() {
  const active = currentStep();
  return `<nav class="progress" aria-label="Этапы диагностики"><ol>${steps.map((label, index) => `
    <li class="${index < active ? "done" : ""} ${index === active ? "active" : ""}" ${index === active ? 'aria-current="step"' : ""}>
      <span>${index < active ? "✓" : index + 1}</span><em>${label}</em>
    </li>`).join("")}</ol><p>Шаг ${active + 1} из ${steps.length}</p></nav>`;
}

function shell(content, modifier = "") {
  return `<div class="page-shell ${modifier}">${progress()}${content}</div>`;
}

function loadingCard(title = "Загружаем данные") {
  return `<section class="state-card" aria-busy="true"><div class="spinner" aria-hidden="true"></div><h1>${escapeHtml(title)}</h1><p>Генерация через AI и безопасный запуск Docker могут занять до нескольких минут.</p></section>`;
}

function errorCard(retryAction) {
  return `<section class="state-card error-card" role="alert"><span class="state-icon" aria-hidden="true">!</span><h1>Не удалось продолжить</h1><p>${escapeHtml(state.error?.message)}</p><button class="button primary" data-action="${retryAction}">Повторить</button></section>`;
}

function render() {
  if (state.loading === "screen") {
    app.innerHTML = shell(loadingCard(state.screen === "welcome" ? "Генерируем и проверяем три задачи" : "Обрабатываем результаты"));
    return;
  }
  if (state.error?.scope === "screen") {
    app.innerHTML = shell(errorCard(state.error.retry));
    return;
  }
  const views = { welcome: renderWelcome, tasks: renderTasks, questions: renderQuestions, profile: renderProfile, roadmap: renderRoadmap };
  app.innerHTML = views[state.screen]();
}

function renderWelcome() {
  return shell(`
    <section class="hero">
      <div class="eyebrow">Диагностика Python · локальный PoC</div>
      <h1>Проверьте практику,<br><span>понимание и следующий шаг</span></h1>
      <p class="hero-copy">Три задачи возрастающей сложности будут сгенерированы DeepSeek, проверены в Docker и разобраны по вашим фактическим решениям.</p>
      <div class="hero-actions"><button class="button primary large" data-action="start">Начать диагностику <span aria-hidden="true">→</span></button><span class="quiet-note">API-ключ остаётся на backend</span></div>
      <div class="expectations" aria-label="Что будет в диагностике">
        <article><strong>01</strong><h2>Три задачи</h2><p>Easy, medium и hard из реального ZEROK-4.</p></article>
        <article><strong>02</strong><h2>Безопасная проверка</h2><p>Код исполняется только в Docker-песочнице ZEROK-3.</p></article>
        <article><strong>03</strong><h2>Персональный маршрут</h2><p>Вопросы ZEROK-5, профиль и roadmap ZEROK-6.</p></article>
      </div>
      <aside class="demo-notice"><span aria-hidden="true">i</span><p><strong>Нужны DeepSeek и Docker.</strong> При недоступности любого компонента интерфейс покажет явную ошибку и не подменит результат mock-данными.</p></aside>
    </section>`, "welcome-page");
}

function canOpenTask(index) {
  return state.diagnostic.tasks.slice(0, index).every((task) => state.checks[task.id]?.evaluation.state === "passed");
}

function renderTasks() {
  if (!state.diagnostic) return shell(loadingCard("Готовим задачи"));
  const task = state.diagnostic.tasks[state.activeTask];
  const presentation = state.diagnostic.taskPresentation[task.id] || { starterCode: "", examples: [] };
  const code = state.codes[task.id] ?? presentation.starterCode;
  const result = state.checks[task.id];
  const busy = state.loading === `check-${task.id}`;
  const inlineError = state.error?.scope === `check-${task.id}` ? `
    <div class="inline-alert error" role="alert"><span aria-hidden="true">!</span><div><strong>Проверка не завершена</strong><p>${escapeHtml(state.error.message)}</p></div><button class="text-button" data-action="check">Повторить</button></div>` : "";
  const evaluationLabels = {
    passed: { icon: "✓", heading: "Решение прошло проверку", className: "success" },
    failed: { icon: "×", heading: result?.evaluation.kind === "incorrect_output" ? "Неверный результат" : result?.evaluation.kind === "timeout" ? "Превышено время" : result?.evaluation.kind === "syntax_error" ? "Синтаксическая ошибка" : "Ошибка выполнения", className: "failure" },
  };
  const evaluationView = result ? evaluationLabels[result.evaluation.state] : null;
  const resultHtml = result && evaluationView ? `
    <div class="result ${evaluationView.className}" role="status">
      <div class="result-heading"><span aria-hidden="true">${evaluationView.icon}</span><div><small>${escapeHtml(result.evaluation.kind)} · попытка ${result.answer.attempt_number}</small><h3>${evaluationView.heading}</h3></div></div>
      <p>${escapeHtml(result.answer.feedback)}</p><code>${escapeHtml(result.evaluation.details)}</code>
      ${result.answer.execution_log ? `<pre class="execution-log">${escapeHtml(result.answer.execution_log)}</pre>` : ""}
    </div>` : "";
  const examples = presentation.examples?.length
    ? `<div class="examples"><h3>Открытые примеры</h3>${presentation.examples.map((example) => `<div><span><small>Ввод</small><code>${escapeHtml(example.input_data)}</code></span><span aria-hidden="true">→</span><span><small>Результат</small><code>${escapeHtml(example.expected_output)}</code></span></div>`).join("")}</div>`
    : `<div class="inline-alert info"><span aria-hidden="true">i</span><div><strong>Проверки скрыты</strong><p>Входы и ожидаемые результаты не передаются в браузер.</p></div></div>`;
  return shell(`
    <div class="task-layout">
      <aside class="task-sidebar" aria-label="Задачи диагностики">
        <div><span class="eyebrow">${escapeHtml(state.diagnostic.taskSet.title)}</span><h1>Практические задачи</h1><p>Черновики хранятся в этой вкладке.</p></div>
        <ol>${state.diagnostic.tasks.map((item, index) => `<li><button data-action="task" data-index="${index}" class="${index === state.activeTask ? "active" : ""}" ${canOpenTask(index) ? "" : "disabled"}><span>${state.checks[item.id]?.evaluation.state === "passed" ? "✓" : index + 1}</span><span><small>${difficultyLabels[item.difficulty] || item.difficulty}</small>${escapeHtml(item.title)}</span></button></li>`).join("")}</ol>
      </aside>
      <section class="task-card">
        <div class="task-meta"><span class="difficulty ${task.difficulty}">${difficultyLabels[task.difficulty] || task.difficulty}</span><span>Задача ${state.activeTask + 1} из 3</span><span>Python</span></div>
        <h2>${escapeHtml(task.title)}</h2><p class="statement">${escapeHtml(task.statement)}</p>${examples}
        <label class="editor-label" for="code-editor"><span>Ваше решение</span><small>Python 3 · stdin → stdout</small></label>
        <div class="editor-wrap"><div class="editor-dots" aria-hidden="true"><i></i><i></i><i></i></div><textarea id="code-editor" data-field="code" data-task-id="${task.id}" spellcheck="false" autocapitalize="off">${escapeHtml(code)}</textarea></div>
        <p id="code-error" class="field-error ${state.error?.scope === "code" ? "visible" : ""}">${state.error?.scope === "code" ? escapeHtml(state.error.message) : ""}</p>
        ${inlineError}${resultHtml}
        <div class="task-actions"><button class="button secondary" data-action="check" ${busy ? "disabled" : ""}>${busy ? '<span class="button-spinner" aria-hidden="true"></span> Проверяем в Docker…' : "Проверить решение"}</button><button class="button primary" data-action="next-task" ${result?.evaluation.state !== "passed" || busy ? "disabled" : ""}>${state.activeTask === 2 ? "Перейти к вопросам" : "Следующая задача"} <span aria-hidden="true">→</span></button></div>
      </section>
    </div>`);
}

function discussionEntries() {
  if (!state.discussion || !state.diagnostic) return [];
  return state.discussion.flatMap((review) => {
    const task = state.diagnostic.tasks.find((item) => item.id === review.task_id);
    return review.questions.map((question) => ({ ...question, key: `${review.answer_id}:${question.order}`, answerId: review.answer_id, taskTitle: task?.title || "Задача" }));
  });
}

function renderQuestions() {
  if (!state.discussion) return shell(loadingCard("Подбираем вопросы по решениям"));
  const busy = state.loading === "explanations";
  const questions = discussionEntries();
  return shell(`
    <section class="content-card narrow">
      <div class="eyebrow">ZEROK-5 · разбор решений</div><h1>Объясните ход мысли</h1>
      <p class="lead">Вопросы сгенерированы по коду, который вы действительно отправили. Ответы станут наблюдениями для предварительного профиля.</p>
      <form id="questions-form" novalidate>
        ${questions.map((question, index) => `<div class="question"><div class="question-number">${String(index + 1).padStart(2, "0")}</div><div><div class="question-context"><span>${escapeHtml(question.taskTitle)}</span><span>${escapeHtml(kindLabels[question.kind] || question.kind)}</span>${question.target ? `<code>${escapeHtml(question.target)}</code>` : ""}</div><label for="question-${index}">${escapeHtml(question.text)}</label><textarea id="question-${index}" data-field="explanation" data-question-id="${escapeHtml(question.key)}" placeholder="Опишите ваш подход…">${escapeHtml(state.explanations[question.key] || "")}</textarea><p class="field-error ${state.error?.fields?.includes(question.key) ? "visible" : ""}">Заполните ответ, чтобы продолжить.</p></div></div>`).join("")}
        ${state.error?.scope === "explanations" ? `<div class="inline-alert error" role="alert"><span aria-hidden="true">!</span><div><strong>Ответы не отправлены</strong><p>${escapeHtml(state.error.message)}</p></div><button type="button" class="text-button" data-action="submit-explanations">Повторить</button></div>` : ""}
        <div class="form-actions"><button type="button" class="button ghost" data-action="back-to-tasks">← Вернуться к задачам</button><button type="submit" class="button primary" ${busy ? "disabled" : ""}>${busy ? '<span class="button-spinner" aria-hidden="true"></span> Формируем профиль…' : 'Продолжить <span aria-hidden="true">→</span>'}</button></div>
      </form>
    </section>`);
}

function renderProfile() {
  if (!state.profile) return shell(loadingCard("Собираем профиль знаний"));
  const entries = Object.values(state.profile.skills || {});
  return shell(`
    <section class="content-card profile-card">
      <div class="profile-heading"><div><div class="eyebrow">ZEROK-5 + ZEROK-6</div><h1>Предварительный профиль знаний</h1><p class="lead">${escapeHtml(state.profileSummary || "Профиль построен backend по решениям и assessment.")}</p></div></div>
      <div class="skills-grid">${entries.map((skill) => `<article><div class="skill-top"><span class="skill-icon">${escapeHtml(skill.skill_id.slice(0, 2).toUpperCase())}</span><span class="mastery">${masteryLabels[skill.mastery] || skill.mastery}</span></div><h2>${escapeHtml(skill.skill_id)}</h2><div class="bar" role="img" aria-label="Применение ${Math.round(skill.application * 100)} процентов"><span style="width:${Math.round(skill.application * 100)}%"></span></div><p>Глубина: ${escapeHtml(depthLabels[skill.cognitive_depth] || skill.cognitive_depth)} · самостоятельность: ${Math.round(skill.independence * 100)}%</p><small>${skill.evidence_count} наблюдений</small></article>`).join("") || "<p>Backend не выделил отдельных навыков.</p>"}</div>
      <div class="profile-summary"><div><span class="summary-label">Сильные стороны</span><strong>${escapeHtml((state.profile.strengths || []).join(", ") || "Пока не выделены")}</strong><p>По фактическим наблюдениям диагностики.</p></div><div><span class="summary-label attention">На повторение</span><strong>${escapeHtml((state.profile.needs_review || state.profile.weaknesses || []).join(", ") || "Пока не выделено")}</strong><p>Будет учтено в roadmap.</p></div></div>
      <h2>Оценка понимания</h2><div class="skills-grid">${(state.assessments || []).map((assessment, index) => `<article><div class="skill-top"><span class="skill-icon">${index + 1}</span><span class="mastery">${masteryLabels[assessment.understanding] || assessment.understanding}</span></div><h2>${escapeHtml(state.diagnostic.tasks[index]?.title || `Задача ${index + 1}`)}</h2><p>${escapeHtml(assessment.rationale)}</p><small>Самостоятельность ${Math.round(assessment.independence * 100)}%</small></article>`).join("")}</div>
      <div class="form-actions right"><button class="button primary" data-action="show-roadmap">Построить roadmap <span aria-hidden="true">→</span></button></div>
    </section>`);
}

function renderRoadmap() {
  if (!state.roadmap) return shell(loadingCard("Строим учебный маршрут"));
  return shell(`
    <section class="content-card roadmap-card">
      <div class="roadmap-heading"><div><div class="eyebrow">ZEROK-6 · рекомендуемый путь</div><h1>Следующие шаги</h1><p class="lead">${escapeHtml(state.roadmap.goal)}</p></div><span class="version">Версия ${state.roadmap.version}</span></div>
      <ol class="timeline">${state.roadmap.steps.map((step, index) => `<li><div class="timeline-marker"><span>${index + 1}</span></div><article><div><span class="step-type">${escapeHtml(stepTypeLabels[step.step_type] || step.step_type)}</span><span class="difficulty ${step.difficulty}">${escapeHtml(difficultyLabels[step.difficulty] || step.difficulty)}</span></div><h2>${escapeHtml(step.title)}</h2><p>${escapeHtml(step.description)}</p><small>Почему: ${escapeHtml(step.rationale)}</small></article></li>`).join("")}</ol>
      ${(state.roadmap.recommendations || []).length ? `<div class="inline-alert info"><span aria-hidden="true">i</span><div><strong>Рекомендации</strong>${state.roadmap.recommendations.map((item) => `<p>${escapeHtml(item.action)} — ${escapeHtml(item.rationale)}</p>`).join("")}</div></div>` : ""}
      <div class="completion"><span aria-hidden="true">✓</span><div><h2>Диагностика завершена</h2><p>Результат получен из реального pipeline без frontend mock-данных.</p></div></div>
      <div class="form-actions split"><button class="button ghost" data-action="back-to-profile">← К профилю</button><button class="button primary" data-action="restart">Начать заново</button></div>
    </section>`);
}

function handleInput(event) {
  const target = event.target;
  if (target.matches('[data-field="code"]')) {
    const taskId = target.dataset.taskId;
    state.codes[taskId] = target.value;
    if (state.checks[taskId]) {
      delete state.checks[taskId];
      state.discussion = null;
      state.assessments = null;
      state.profile = null;
      state.profileSummary = null;
      state.roadmap = null;
      document.querySelector(".result")?.remove();
      const nextButton = document.querySelector('[data-action="next-task"]');
      if (nextButton) nextButton.disabled = true;
    }
    if (state.error?.scope === "code") state.error = null;
    persist();
  }
  if (target.matches('[data-field="explanation"]')) {
    state.explanations[target.dataset.questionId] = target.value;
    if (state.error?.fields) state.error.fields = state.error.fields.filter((id) => id !== target.dataset.questionId);
    persist();
  }
}

async function handleClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === "start" || action === "retry-diagnostic") return loadDiagnostic();
  if (action === "task" && canOpenTask(Number(button.dataset.index))) return update({ activeTask: Number(button.dataset.index), error: null });
  if (action === "check") return checkCurrentTask();
  if (action === "next-task") return nextTask();
  if (action === "back-to-tasks") return update({ screen: "tasks", activeTask: 2, error: null }, { focusMain: true });
  if (action === "submit-explanations") return submitExplanations();
  if (action === "retry-discussion") return loadDiscussion();
  if (action === "retry-profile") return loadProfile();
  if (action === "show-roadmap" || action === "retry-roadmap") return loadRoadmap();
  if (action === "back-to-profile") return update({ screen: "profile", error: null }, { focusMain: true });
  if (action === "restart") return restart();
}

async function runScreenRequest(request, onSuccess, retry, titleScreen = state.screen) {
  if (state.loading) return;
  update({ loading: "screen", error: null, screen: titleScreen });
  try {
    onSuccess(await request());
  } catch (error) {
    update({ loading: null, error: { scope: "screen", message: error.message, retry } });
    announce("Ошибка загрузки. Доступна повторная попытка.");
  }
}

function loadDiagnostic() {
  return runScreenRequest(() => api.createDiagnostic(), (diagnostic) => {
    const codes = {};
    diagnostic.tasks.forEach((task) => { codes[task.id] = diagnostic.taskPresentation[task.id]?.starterCode || ""; });
    update({ ...initialState, diagnostic, codes, screen: "tasks" }, { focusMain: true });
  }, "retry-diagnostic", "welcome");
}

async function checkCurrentTask() {
  if (state.loading) return;
  const task = state.diagnostic.tasks[state.activeTask];
  const content = state.codes[task.id]?.trim() || "";
  if (!content) {
    update({ error: { scope: "code", message: "Введите код перед проверкой." } });
    requestAnimationFrame(() => document.querySelector("#code-editor")?.focus());
    return;
  }
  update({ loading: `check-${task.id}`, error: null });
  try {
    const result = await api.submitSolution(state.diagnostic.session_id, task.id, content);
    update({ checks: { ...state.checks, [task.id]: result }, attempts: { ...state.attempts, [task.id]: result.answer.attempt_number }, loading: null, error: null });
    announce(result.answer.feedback);
  } catch (error) {
    update({ loading: null, error: { scope: `check-${task.id}`, message: error.message } });
    announce("Ошибка проверки. Доступна повторная попытка.");
  }
}

function nextTask() {
  const task = state.diagnostic.tasks[state.activeTask];
  if (state.checks[task.id]?.evaluation.state !== "passed") return;
  if (state.activeTask < 2) {
    update({ activeTask: state.activeTask + 1, error: null });
    requestAnimationFrame(() => document.querySelector("#code-editor")?.focus());
  } else {
    loadDiscussion();
  }
}

function loadDiscussion() {
  return runScreenRequest(() => api.createReviews(state.diagnostic.session_id), (discussion) => update({ discussion, screen: "questions", loading: null, error: null }, { focusMain: true }), "retry-discussion", "questions");
}

async function submitExplanations() {
  if (state.loading) return;
  const questions = discussionEntries();
  const empty = questions.filter((question) => !state.explanations[question.key]?.trim()).map((question) => question.key);
  if (empty.length) {
    update({ error: { scope: "validation", fields: empty } });
    const first = questions.findIndex((question) => question.key === empty[0]);
    requestAnimationFrame(() => document.querySelector(`#question-${first}`)?.focus());
    announce("Заполните все ответы.");
    return;
  }
  update({ loading: "explanations", error: null });
  const answers = questions.map((question) => ({ answer_id: question.answerId, question_order: question.order, content: state.explanations[question.key] }));
  try {
    const result = await api.submitExplanations(state.diagnostic.session_id, answers);
    state.assessments = result.assessments;
    await loadProfile(true);
  } catch (error) {
    update({ loading: null, error: { scope: "explanations", message: error.message } });
    announce("Ошибка отправки ответов. Доступна повторная попытка.");
  }
}

async function loadProfile(fromSubmission = false) {
  if (!fromSubmission && state.loading) return;
  update({ loading: "screen", error: null, screen: "profile" });
  try {
    const result = await api.getProfile(state.diagnostic.session_id);
    update({ profile: result.profile, profileSummary: result.profile_summary, assessments: result.assessments, screen: "profile", loading: null, error: null }, { focusMain: true });
  } catch (error) {
    update({ loading: null, error: { scope: "screen", message: error.message, retry: "retry-profile" } });
  }
}

function loadRoadmap() {
  return runScreenRequest(() => api.getRoadmap(state.diagnostic.session_id), (roadmap) => update({ roadmap, screen: "roadmap", loading: null, error: null }, { focusMain: true }), "retry-roadmap", "roadmap");
}

function restart() {
  sessionStorage.removeItem(STORAGE_KEY);
  state = { ...initialState };
  render();
  app.focus();
  announce("Диагностика начата заново.");
}
