import { mockApi } from "./mock-data.js";

const STORAGE_KEY = "zerok-7-session-v2";
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
  attempts: {},
  explanations: {},
  loading: null,
  error: null,
};

let state = loadState();
const app = document.querySelector("#app");
const announcer = document.querySelector("#announcer");
const scenarioSelect = document.querySelector("#mock-scenario");
scenarioSelect.value = mockApi.getTransportMode();

scenarioSelect.addEventListener("change", () => {
  mockApi.setTransportMode(scenarioSelect.value);
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
  const evaluationLabels = {
    passed: { icon: "✓", heading: "Подготовленные тесты пройдены", className: "success" },
    failed: { icon: "×", heading: "Есть несовпадение с ожидаемым результатом", className: "failure" },
    error: { icon: "!", heading: result?.evaluation.kind === "syntax_error" ? "Синтаксическая ошибка" : "Ошибка выполнения", className: "failure" },
    not_evaluated: { icon: "?", heading: "Корректность не определена", className: "neutral" },
  };
  const evaluationView = result ? evaluationLabels[result.evaluation.state] : null;
  const resultHtml = result ? `
    <div class="result ${evaluationView.className}" role="status">
      <div class="result-heading"><span aria-hidden="true">${evaluationView.icon}</span><div><small>Симуляция · ${escapeHtml(result.evaluation.state)} · попытка ${result.answer.attempt_number}</small><h3>${evaluationView.heading}</h3></div></div>
      <p>${escapeHtml(result.answer.feedback)}</p>
      <code>${escapeHtml(result.evaluation.details)}</code>
      <p class="result-disclaimer"><strong>Важно:</strong> код фактически не выполнялся. Заглушка распознаёт только перечисленные подготовленные образцы; произвольный код остаётся непроверенным.</p>
    </div>` : "";
  const canContinue = result?.evaluation.state === "passed";
  return shell(`
    <div class="task-layout">
      <aside class="task-sidebar" aria-label="Задачи диагностики">
        <div><span class="eyebrow">${escapeHtml(state.diagnostic.taskSet.title)}</span><h1>Практические задачи</h1><p>Решайте в удобном темпе. Черновики сохраняются в этой вкладке.</p></div>
        <ol>${state.diagnostic.tasks.map((item, index) => `<li><button data-action="task" data-index="${index}" class="${index === state.activeTask ? "active" : ""}"><span>${state.checks[item.id]?.evaluation.state === "passed" ? "✓" : index + 1}</span><span><small>${difficultyLabels[item.difficulty]}</small>${escapeHtml(item.title)}</span></button></li>`).join("")}</ol>
      </aside>
      <section class="task-card">
        <div class="task-meta"><span class="difficulty ${task.difficulty}">${difficultyLabels[task.difficulty]}</span><span>Задача ${state.activeTask + 1} из 3</span><span>Python</span></div>
        <h2>${escapeHtml(task.title)}</h2>
        <p class="statement">${escapeHtml(task.statement)}</p>
        <div class="examples"><h3>Примеры</h3>${presentation.examples.map((example) => `<div><span><small>Ввод</small><code>${escapeHtml(example.input_data)}</code></span><span aria-hidden="true">→</span><span><small>Результат</small><code>${escapeHtml(example.expected_output)}</code></span></div>`).join("")}</div>
        <div class="fixture-panel"><div><h3>Сценарии проверки заглушки</h3><p>Подставьте известный образец. Любой другой код останется непроверенным до подключения ZEROK-8.</p></div><div class="fixture-actions">${presentation.fixtures.map((fixture) => `<button class="fixture-button ${fixture.id}" data-action="apply-fixture" data-fixture-id="${fixture.id}" title="${escapeHtml(fixture.description)}">${escapeHtml(fixture.label)}</button>`).join("")}</div></div>
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

function discussionEntries() {
  if (!state.discussion || !state.diagnostic) return [];
  return state.discussion.flatMap((review) => {
    const task = state.diagnostic.tasks.find((item) => item.id === review.task_id);
    return review.questions.map((question) => ({
      ...question,
      key: `${review.answer_id}:${question.order}`,
      answerId: review.answer_id,
      taskTitle: task?.title || "Задача",
    }));
  });
}

function renderQuestions() {
  if (!state.discussion) return shell(loadingCard("Подбираем вопросы по решениям"));
  const busy = state.loading === "explanations";
  const questions = discussionEntries();
  const kindLabels = { strategy: "Стратегия", transfer: "Перенос", explanation: "Объяснение", understanding: "Понимание", error_detection: "Поиск ошибки", calibration: "Самооценка" };
  return shell(`
    <section class="content-card narrow">
      <div class="eyebrow">Объясните ход мысли</div><h1>Вопросы по вашим образцам</h1>
      <p class="lead">Это подготовленные вопросы в структуре ZEROK-5. Они относятся только к конструкциям, которые действительно присутствуют в успешно принятом демонстрационном коде.</p>
      <div class="inline-alert info"><span aria-hidden="true">i</span><div><strong>Вопросы не сгенерированы AI</strong><p>До ZEROK-8 используются разные заранее написанные наборы для каждой задачи.</p></div></div>
      <form id="questions-form" novalidate>
        ${questions.map((question, index) => `<div class="question"><div class="question-number">${String(index + 1).padStart(2, "0")}</div><div><div class="question-context"><span>${escapeHtml(question.taskTitle)}</span><span>${escapeHtml(kindLabels[question.kind] || question.kind)}</span>${question.target ? `<code>${escapeHtml(question.target)}</code>` : ""}</div><label for="question-${index}">${escapeHtml(question.text)}</label><textarea id="question-${index}" data-field="explanation" data-question-id="${escapeHtml(question.key)}" placeholder="Опишите ваш подход…">${escapeHtml(state.explanations[question.key] || "")}</textarea><p class="field-error ${state.error?.fields?.includes(question.key) ? "visible" : ""}">Заполните ответ, чтобы продолжить.</p></div></div>`).join("")}
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
    const taskId = target.dataset.taskId;
    state.codes[taskId] = target.value;
    if (state.checks[taskId]) {
      delete state.checks[taskId];
      state.discussion = null;
      state.profile = null;
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
  if (action === "task") return update({ activeTask: Number(button.dataset.index), error: null });
  if (action === "apply-fixture") return applyFixture(button.dataset.fixtureId);
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

function applyFixture(fixtureId) {
  const task = state.diagnostic.tasks[state.activeTask];
  const fixture = state.diagnostic.taskPresentation[task.id].fixtures.find((item) => item.id === fixtureId);
  if (!fixture) return;
  const checks = { ...state.checks };
  delete checks[task.id];
  update({
    codes: { ...state.codes, [task.id]: fixture.code },
    checks,
    discussion: null,
    profile: null,
    roadmap: null,
    error: null,
  });
  requestAnimationFrame(() => document.querySelector("#code-editor")?.focus());
  announce(`Подставлен сценарий: ${fixture.label}.`);
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
    attempt_number: (state.attempts[task.id] || 0) + 1,
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
    update({ checks: { ...state.checks, [task.id]: result }, attempts: { ...state.attempts, [task.id]: answer.attempt_number }, loading: null, error: null });
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
  const results = state.diagnostic.tasks.map((task) => state.checks[task.id]);
  return runScreenRequest(() => mockApi.getDiscussion(results), (discussion) => update({ discussion, screen: "questions", loading: null, error: null }, { focusMain: true }), "retry-discussion");
}

async function submitExplanations() {
  if (state.loading) return;
  const questions = discussionEntries();
  const empty = questions.filter((question) => !state.explanations[question.key]?.trim()).map((question) => question.key);
  if (empty.length) {
    update({ error: { scope: "validation", fields: empty } });
    const firstEmptyIndex = questions.findIndex((question) => question.key === empty[0]);
    requestAnimationFrame(() => document.querySelector(`#question-${firstEmptyIndex}`)?.focus());
    announce("Заполните все ответы.");
    return;
  }
  update({ loading: "explanations", error: null });
  const answers = questions.map((question) => ({ answer_id: question.answerId, question_order: question.order, content: state.explanations[question.key] }));
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
