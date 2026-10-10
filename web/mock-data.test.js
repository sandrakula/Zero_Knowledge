import assert from "node:assert/strict";
import test from "node:test";

import { MockDiagnosticService } from "./mock-data.js";

const noWait = async () => {};

async function setup(options = {}) {
  const service = new MockDiagnosticService({ delay: 0, wait: noWait, ...options });
  const diagnostic = await service.getDiagnostic();
  return { service, diagnostic };
}

function answerDraft(task, content, attemptNumber = 1) {
  return {
    task_id: task.id,
    student_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    attempt_number: attemptNumber,
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
}

function fixture(diagnostic, task, id) {
  return diagnostic.taskPresentation[task.id].fixtures.find((item) => item.id === id);
}

test("arbitrary and empty code are never reported as passed", async () => {
  const { service, diagnostic } = await setup();
  const task = diagnostic.tasks[0];

  for (const content of ["", "def invented():\n    return 42"]) {
    const result = await service.checkAnswer(answerDraft(task, content));
    assert.equal(result.evaluation.state, "not_evaluated");
    assert.equal(result.answer.status, "pending");
    assert.equal(result.answer.is_correct, null);
    assert.equal(result.review, null);
  }
});

test("only the explicit passed fixture produces a successful Answer and SolutionReview", async () => {
  const { service, diagnostic } = await setup();
  const task = diagnostic.tasks[0];
  const code = fixture(diagnostic, task, "passed").code;
  const result = await service.checkAnswer(answerDraft(task, code));

  assert.equal(result.evaluation.state, "passed");
  assert.equal(result.answer.status, "correct");
  assert.equal(result.answer.is_correct, true);
  assert.equal(result.review.answer_id, result.answer.id);
  assert.equal(result.review.task_id, task.id);
  assert.equal(result.review.assessment.understanding, "expert");
});

test("known incorrect output, syntax error and execution error remain distinct", async () => {
  const { service, diagnostic } = await setup();
  const task = diagnostic.tasks[0];
  const expected = [
    ["failed", "failed", "output_mismatch"],
    ["syntax_error", "error", "syntax_error"],
    ["execution_error", "error", "execution_error"],
  ];

  for (const [fixtureId, state, kind] of expected) {
    const result = await service.checkAnswer(answerDraft(task, fixture(diagnostic, task, fixtureId).code));
    assert.equal(result.evaluation.state, state);
    assert.equal(result.evaluation.kind, kind);
    assert.equal(result.answer.status, "incorrect");
    assert.equal(result.answer.is_correct, false);
    assert.equal(result.review, null);
  }
});

test("a successful resubmission replaces a failed attempt without hiding attempt number", async () => {
  const { service, diagnostic } = await setup();
  const task = diagnostic.tasks[0];
  const failed = await service.checkAnswer(answerDraft(task, fixture(diagnostic, task, "failed").code, 1));
  const passed = await service.checkAnswer(answerDraft(task, fixture(diagnostic, task, "passed").code, 2));

  assert.equal(failed.evaluation.state, "failed");
  assert.equal(passed.evaluation.state, "passed");
  assert.equal(passed.answer.attempt_number, 2);
});

test("different tasks receive different questions grounded in their known code", async () => {
  const { service, diagnostic } = await setup();
  const results = [];
  for (const task of diagnostic.tasks) {
    const code = fixture(diagnostic, task, "passed").code;
    const result = await service.checkAnswer(answerDraft(task, code));
    results.push(result);
    assert.ok(code.includes(result.review.questions[0].target));
  }

  const reviews = await service.getDiscussion(results);
  assert.equal(reviews.length, 3);
  assert.equal(new Set(reviews.map((review) => review.questions[0].text)).size, 3);
  assert.match(reviews[0].questions[0].text, /number > 0/);
  assert.match(reviews[1].questions[0].text, /counts/);
  assert.match(reviews[2].questions[0].text, /сортируются/);
});

test("questions are unavailable while any task is unsuccessful", async () => {
  const { service, diagnostic } = await setup();
  const task = diagnostic.tasks[0];
  const failed = await service.checkAnswer(answerDraft(task, fixture(diagnostic, task, "failed").code));

  assert.throws(() => service.getDiscussion([failed]), /только после успешной проверки/);
});

test("network failure happens once per operation and retry succeeds", async () => {
  const { service, diagnostic } = await setup();
  service.setTransportMode("network-error");
  const task = diagnostic.tasks[0];
  const draft = answerDraft(task, fixture(diagnostic, task, "passed").code);

  await assert.rejects(service.checkAnswer(draft), /Демонстрационный сбой/);
  const retried = await service.checkAnswer(draft);
  assert.equal(retried.evaluation.state, "passed");
});
