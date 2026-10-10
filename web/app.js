import { mockApi } from "./mock-data.js";

const STORAGE_KEY = "zerok-7-session-v1";
const steps = ["Старт", "Задачи", "Вопросы", "Профиль", "Roadmap"];
const difficultyLabels = { easy: "Лёгкая", medium: "Средняя", hard: "Сложная" };
const masteryLabels = { novice: "Начальный", developing: "Развивается", proficient: "Уверенный" };
const skillLabels = {
  "python.collections": "Коллекции Python",
  "algorithms.complexity": "Сложность алгоритмов",
  "algorithms.intervals": "Работа с интервалами",
};

const initialState = {
  screen: "welcome",
  activeTask: 0,
  diagnostic: null,
  discussion: null,
  profile: null,
  roadmap: null,
  codes: {},
  checks: {},
  explanations: {},
  loading: null,
  error: null,
};

let state = loadState();
const app = document.querySelector("#app");
const announcer = document.querySelector("#announcer");
const scenarioSelect = document.querySelector("#mock-scenario");
scenarioSelect.value = mockApi.getScenario();

scenarioSelect.addEventListener("change", () => {
  mockApi.setScenario(scenarioSelect.value);
  announce(`Выбран сценарий: ${scenarioSelect.options[scenarioSelect.selectedIndex].text}`);
});

app.addEventListener("click", handleClick);
app.addEventListener("input", handleInput);
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
  if (options.focusMain) {
    requestAnimationFrame(() => app.focus());
  }
}

function announce(message) {
  announcer.textContent = "";
  requestAnimationFrame(() => { announcer.textContent = message; });
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function observationLabel(count) {
  if (count === 1) return "демонстрационное наблюдение";
  if (count > 1 && count < 5) return "демонстрационных наблюдения";
  return "демонстрационных наблюдений";
}

function currentStep() {
  return { welcome: 0, tasks: 1, questions: 2, profile: 3, roadmap: 4 }[state.screen] ?? 0;
}

function progress() {
  const active = currentStep();
  return `
    <nav class="progress" aria-label="Этапы диагностики">
      <ol>${steps.map((label, index) => `
        <li class="${index < active ? "done" : ""} ${index === active ? "active" : ""}" ${index === active ? 'aria-current="step"' : ""}>
          <span>${index < active ? "✓" : index + 1}</span><em>${label}</em>
        </li>`).join("")}</ol>
      <p>Шаг ${active + 1} из ${steps.length}</p>
    </nav>`;
}

function shell(content, modifier = "") {
  return `<div class="page-shell ${modifier}">${progress()}${content}</div>`;
}

function loadingCard(title = "Загружаем данные") {
  return `<section class="state-card" aria-busy="true"><div class="spinner" aria-hidden="true"></div><h1>${title}</h1><p>Это займёт меньше секунды в демонстрационном режиме.</p></section>`;
}

function errorCard(retryAction) {
  return `<section class="state-card error-card" role="alert"><span class="state-icon" aria-hidden="true">!</span><h1>Не удалось продолжить</h1><p>${escapeHtml(state.error?.message)}</p><button class="button primary" data-action="${retryAction}">Повторить</button></section>`;
}

function render() {
  if (state.loading === "screen") {
    app.innerHTML = shell(loadingCard());
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
      <div class="eyebrow">Диагностика Python · 10–15 минут</div>
      <h1>Узнайте, что уже получается,<br><span>и куда двигаться дальше</span></h1>
      <p class="hero-copy">Решите три задачи возрастающей сложности, объясните свой подход и получите пример предварительного профиля знаний с учебным маршрутом.</p>
      <div class="hero-actions">
        <button class="button primary large" data-action="start">Начать диагностику <span aria-hidden="true">→</span></button>
        <span class="quiet-note">Без регистрации и запуска вашего кода</span>
      </div>
      <div class="expectations" aria-label="Что будет в диагностике">
        <article><strong>01</strong><h2>Три задачи</h2><p>От работы со списком до алгоритма с интервалами.</p></article>
        <article><strong>02</strong><h2>Разбор подхода</h2><p>Короткие вопросы о решении и сложности.</p></article>
        <article><strong>03</strong><h2>Учебный маршрут</h2><p>Наглядный пример профиля и следующих тем.</p></article>
      </div>
      <aside class="demo-notice"><span aria-hidden="true">i</span><p><strong>Это интерактивный прототип.</strong> Код не отправляется на сервер и не выполняется. Результаты и оценки подготовлены заранее для демонстрации сценария.</p></aside>
    </section>`, "welcome-page");
}

function renderTasks() {
  if (!state.diagnostic) return shell(loadingCard("Готовим задачи"));
  const task = state.diagnostic.tasks[state.activeTask];
  const presentation = state.diagnostic.taskPresentation[task.id];
  const code = state.codes[task.id] ?? presentation.starterCode;
  const result = state.checks[task.id];
  const busy = state.loading === `check-${task.id}`;
  const inlineError = state.error?.scope === `check-${task.id}` ? `
    <div class="inline-alert error" role="alert"><span aria-hidden="true">!</span><div><strong>Проверка не завершена</strong><p>${escapeHtml(state.error.message)}</p></div><button class="text-button" data-action="check">Повторить</button></div>` : "";
  const resultHtml = result ? `
    <div class="result ${result.is_correct ? "success" : "failure"}" role="status">
      <div class="result-heading"><span aria-hidden="true">${result.is_correct ? "✓" : "×"}</span><div><small>Демонстрационный результат</small><h3>${result.is_correct ? "Подготовленные тесты пройдены" : "Есть несовпадение с ожидаемым результатом"}</h3></div></div>
      <p>${escapeHtml(result.feedback)}</p>
      <code>${escapeHtml(result.execution_log)}</code>
      <p class="result-disclaimer"><strong>Важно:</strong> введённый код фактически не выполнялся, это ответ заглушки.</p>
    </div>` : "";
  const canContinue = Boolean(result);
  return shell(`
    <div class="task-layout">
      <aside class="task-sidebar" aria-label="Задачи диагностики">
        <div><span class="eyebrow">${escapeHtml(state.diagnostic.taskSet.title)}</span><h1>Практические задачи</h1><p>Решайте в удобном темпе. Черновики сохраняются в этой вкладке.</p></div>
        <ol>${state.diagnostic.tasks.map((item, index) => `<li><button data-action="task" data-index="${index}" class="${index === state.activeTask ? "active" : ""}"><span>${state.checks[item.id] ? "✓" : index + 1}</span><span><small>${difficultyLabels[item.difficulty]}</small>${escapeHtml(item.title)}</span></button></li>`).join("")}</ol>
      </aside>
      <section class="task-card">
        <div class="task-meta"><span class="difficulty ${task.difficulty}">${difficultyLabels[task.difficulty]}</span><span>Задача ${state.activeTask + 1} из 3</span><span>Python</span></div>
        <h2>${escapeHtml(task.title)}</h2>
        <p class="statement">${escapeHtml(task.statement)}</p>
        <div class="examples"><h3>Примеры</h3>${presentation.examples.map((example) => `<div><span><small>Ввод</small><code>${escapeHtml(example.input_data)}</code></span><span aria-hidden="true">→</span><span><small>Результат</small><code>${escapeHtml(example.expected_output)}</code></span></div>`).join("")}</div>
        <label class="editor-label" for="code-editor"><span>Ваше решение</span><small>Python 3</small></label>
        <div class="editor-wrap"><div class="editor-dots" aria-hidden="true"><i></i><i></i><i></i></div><textarea id="code-editor" data-field="code" data-task-id="${task.id}" spellcheck="false" autocapitalize="off">${escapeHtml(code)}</textarea></div>
        <p id="code-error" class="field-error ${state.error?.scope === "code" ? "visible" : ""}">${state.error?.scope === "code" ? escapeHtml(state.error.message) : ""}</p>
        ${inlineError}${resultHtml}
        <div class="task-actions">
          <button class="button secondary" data-action="check" ${busy ? "disabled" : ""}>${busy ? '<span class="button-spinner" aria-hidden="true"></span> Проверяем…' : "Проверить решение"}</button>
          <button class="button primary" data-action="next-task" ${!canContinue || busy ? "disabled" : ""}>${state.activeTask === 2 ? "Перейти к вопросам" : "Следующая задача"} <span aria-hidden="true">→</span></button>
        </div>
      </section>
    </div>`);
}

function renderQuestions() {
  if (!state.discussion) return shell(loadingCard("Подбираем вопросы по решениям"));
  const busy = state.loading === "explanations";
  return shell(`
    <section class="content-card narrow">
      <div class="eyebrow">Объясните ход мысли</div><h1>Несколько вопросов по решениям</h1>
      <p class="lead">Здесь важен не идеальный термин, а логика рассуждения. Ответы сохраняются при переходах в этой вкладке.</p>
      <form id="questions-form" novalidate>
        ${state.discussion.map((question, index) => `<div class="question"><div class="question-number">0${index + 1}</div><div><label for="question-${question.id}">${escapeHtml(question.statement)}</label><textarea id="question-${question.id}" data-field="explanation" data-question-id="${question.id}" placeholder="Опишите ваш подход…">${escapeHtml(state.explanations[question.id] || "")}</textarea><p class="field-error ${state.error?.fields?.includes(question.id) ? "visible" : ""}">Заполните ответ, чтобы продолжить.</p></div></div>`).join("")}
        ${state.error?.scope === "explanations" ? `<div class="inline-alert error" role="alert"><span aria-hidden="true">!</span><div><strong>Ответы не отправлены</strong><p>${escapeHtml(state.error.message)}</p></div><button type="button" class="text-button" data-action="submit-explanations">Повторить</button></div>` : ""}
        <div class="form-actions"><button type="button" class="button ghost" data-action="back-to-tasks">← Вернуться к задачам</button><button type="submit" class="button primary" ${busy ? "disabled" : ""}>${busy ? '<span class="button-spinner" aria-hidden="true"></span> Сохраняем…' : 'Продолжить <span aria-hidden="true">→</span>'}</button></div>
      </form>
    </section>`);
}

function renderProfile() {
  if (!state.profile) return shell(loadingCard("Собираем пример профиля"));
  const entries = Object.values(state.profile.skills);
  return shell(`
    <section class="content-card profile-card">
      <div class="profile-heading"><div><div class="eyebrow">Предварительный профиль</div><h1>Пример картины знаний</h1><p class="lead">Так может выглядеть результат после настоящей проверки и анализа объяснений.</p></div><div class="sample-stamp">Пример<br>не оценка</div></div>
      <div class="inline-alert info"><span aria-hidden="true">i</span><div><strong>Это подготовленные демонстрационные значения</strong><p>Они не рассчитаны по вашему коду или ответам и не отражают ваш фактический уровень.</p></div></div>
      <div class="skills-grid">${entries.map((skill) => `<article><div class="skill-top"><span class="skill-icon">${skill.skill_id.includes("python") ? "Py" : "Al"}</span><span class="mastery">${masteryLabels[skill.mastery]}</span></div><h2>${skillLabels[skill.skill_id]}</h2><div class="bar" role="img" aria-label="Демонстрационный показатель освоения ${Math.round(skill.application * 100)} процентов"><span style="width:${skill.application * 100}%"></span></div><p>${skill.skill_id === "python.collections" ? "Уверенное применение базовых структур." : skill.skill_id === "algorithms.complexity" ? "Стоит укрепить анализ стоимости решения." : "Нужна практика с сортировкой и границами."}</p><small>${skill.evidence_count} ${observationLabel(skill.evidence_count)}</small></article>`).join("")}</div>
      <div class="profile-summary"><div><span class="summary-label">Сильная сторона</span><strong>Коллекции Python</strong><p>Выбор словаря для подсчёта частот.</p></div><div><span class="summary-label attention">Зона роста</span><strong>Интервалы и сложность</strong><p>Разбор сортировки и граничных случаев.</p></div></div>
      <div class="form-actions right"><button class="button primary" data-action="show-roadmap">Посмотреть roadmap <span aria-hidden="true">→</span></button></div>
    </section>`);
}

function renderRoadmap() {
  if (!state.roadmap) return shell(loadingCard("Строим учебный маршрут"));
  return shell(`
    <section class="content-card roadmap-card">
      <div class="roadmap-heading"><div><div class="eyebrow">Рекомендуемый путь</div><h1>Следующие шаги</h1><p class="lead">${escapeHtml(state.roadmap.goal)}</p></div><span class="version">Версия ${state.roadmap.version} · демо</span></div>
      <ol class="timeline">${state.roadmap.steps.map((step, index) => `<li><div class="timeline-marker"><span>${index + 1}</span></div><article><div><span class="step-type">${({ review: "Повторение", study: "Изучение", practice: "Практика", transfer: "Перенос" })[step.step_type]}</span><span class="difficulty ${step.difficulty}">${difficultyLabels[step.difficulty]}</span></div><h2>${escapeHtml(step.title)}</h2><p>${escapeHtml(step.description)}</p><small>Почему: ${escapeHtml(step.rationale)}</small></article></li>`).join("")}</ol>
      <div class="completion"><span aria-hidden="true">✓</span><div><h2>Демонстрация завершена</h2><p>Ваши черновики останутся в этой вкладке, пока вы не начнёте заново или не закроете сессию браузера.</p></div></div>
      <div class="form-actions split"><button class="button ghost" data-action="back-to-profile">← К профилю</button><button class="button primary" data-action="restart">Начать заново</button></div>
    </section>`);
}

function handleInput(event) {
  const target = event.target;
  if (target.matches('[data-field="code"]')) {
    state.codes[target.dataset.taskId] = target.value;
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
  if (action === "task") return update({ activeTask: Number(button.dataset.index), error: null });
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

app.addEventListener("submit", (event) => {
  if (event.target.id === "questions-form") {
    event.preventDefault();
    submitExplanations();
  }
});

async function runScreenRequest(request, onSuccess, retry) {
  if (state.loading) return;
  update({ loading: "screen", error: null });
  try {
    const value = await request();
    onSuccess(value);
  } catch (error) {
    update({ loading: null, error: { scope: "screen", message: error.message, retry } });
    announce("Ошибка загрузки. Доступна повторная попытка.");
  }
}

function loadDiagnostic() {
  return runScreenRequest(() => mockApi.getDiagnostic(), (diagnostic) => {
    const codes = { ...state.codes };
    diagnostic.tasks.forEach((task) => { if (!(task.id in codes)) codes[task.id] = diagnostic.taskPresentation[task.id].starterCode; });
    update({ diagnostic, codes, screen: "tasks", activeTask: 0, loading: null, error: null }, { focusMain: true });
  }, "retry-diagnostic");
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
  const answer = {
    task_id: task.id,
    student_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    attempt_number: 1,
    format: "code",
    content,
    code_language: "python",
    chosen_options: [],
    used_hint_ids: [],
    confidence: null,
    status: "pending",
    is_correct: null,
    score: null,
    feedback: null,
    execution_log: null,
  };
  try {
    const result = await mockApi.checkAnswer(answer);
    update({ checks: { ...state.checks, [task.id]: result }, loading: null, error: null });
    announce(result.feedback);
  } catch (error) {
    update({ loading: null, error: { scope: `check-${task.id}`, message: error.message } });
    announce("Ошибка проверки. Доступна повторная попытка.");
  }
}

function nextTask() {
  if (state.activeTask < 2) {
    update({ activeTask: state.activeTask + 1, error: null });
    requestAnimationFrame(() => document.querySelector("#code-editor")?.focus());
  } else {
    loadDiscussion();
  }
}

function loadDiscussion() {
  return runScreenRequest(() => mockApi.getDiscussion(), (discussion) => update({ discussion, screen: "questions", loading: null, error: null }, { focusMain: true }), "retry-discussion");
}

async function submitExplanations() {
  if (state.loading) return;
  const empty = state.discussion.filter((question) => !state.explanations[question.id]?.trim()).map((question) => question.id);
  if (empty.length) {
    update({ error: { scope: "validation", fields: empty } });
    requestAnimationFrame(() => document.querySelector(`#question-${empty[0]}`)?.focus());
    announce("Заполните все ответы.");
    return;
  }
  update({ loading: "explanations", error: null });
  const answers = state.discussion.map((question) => ({ task_id: question.id, student_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", attempt_number: 1, format: "explanation", content: state.explanations[question.id], code_language: null, chosen_options: [], used_hint_ids: [], confidence: null, status: "pending" }));
  try {
    await mockApi.submitExplanations(answers);
    await loadProfile(true);
  } catch (error) {
    update({ loading: null, error: { scope: "explanations", message: error.message } });
    announce("Ошибка отправки ответов. Доступна повторная попытка.");
  }
}

async function loadProfile(fromSubmission = false) {
  if (!fromSubmission && state.loading) return;
  update({ loading: "screen", error: null });
  try {
    const profile = await mockApi.getProfile();
    update({ profile, screen: "profile", loading: null, error: null }, { focusMain: true });
  } catch (error) {
    update({ loading: null, error: { scope: "screen", message: error.message, retry: "retry-profile" } });
  }
}

function loadRoadmap() {
  return runScreenRequest(() => mockApi.getRoadmap(), (roadmap) => update({ roadmap, screen: "roadmap", loading: null, error: null }, { focusMain: true }), "retry-roadmap");
}

function restart() {
  sessionStorage.removeItem(STORAGE_KEY);
  state = { ...initialState };
  render();
  app.focus();
  announce("Диагностика начата заново.");
}
