"""Полный живой прогон и наглядный HTML-отчёт.

Цепочка на реальных данных:
ZEROK-1 (DeepSeek) -> ZEROK-4 (генерация задач) -> ZEROK-3 (Docker-прогон
эталонов) -> ZEROK-5 (разбор решений) -> ZEROK-6 (профиль + roadmap).

Требует DEEPSEEK_API_KEY и собранный Docker-образ песочницы. Результат
сохраняется в realtime_demo.html и открывается в браузере по умолчанию.

Запуск:
    python scripts/realtime_demo.py
"""

from __future__ import annotations

import html
import os
import sys
import time
from pathlib import Path
from uuid import UUID

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from zero_knowledge.execution import DockerIsolatedExecutionRunner
from zero_knowledge.llm import DeepSeekClient
from zero_knowledge.profile import ProfileRoadmapService, TaskOutcome
from zero_knowledge.schemas import (
    Answer,
    AnswerFormat,
    Hint,
    HintLevel,
    ReferenceSolution,
)
from zero_knowledge.solution_review import SolutionReviewService
from zero_knowledge.task_generation import TaskBlockService

STUDENT_ID = UUID("00000000-0000-4000-8000-000000000001")
GOAL = "Подготовка к собеседованию по алгоритмам"
OUTPUT = PROJECT_ROOT / "realtime_demo.html"


def _student_answer(task: object, code: str) -> Answer:
    return Answer(
        task_id=task.id,
        student_id=STUDENT_ID,
        format=AnswerFormat.CODE,
        content=code,
        is_correct=True,
    )


def _hints_for(task: object, index: int) -> list[Hint]:
    # Реалистичная имитация: чем сложнее задача, тем больше помощи.
    if index == 0:  # easy — решил сам
        return []
    if index == 1:  # medium — небольшая наводка
        return [
            Hint(
                task_id=task.id,
                level=HintLevel.NUDGE,
                content="Небольшая наводка",
                independence_penalty=0.1,
            )
        ]
    # hard — полная подсказка
    return [
        Hint(
            task_id=task.id,
            level=HintLevel.FULL_EXPLANATION,
            content="Полная подсказка",
            independence_penalty=0.8,
        )
    ]


def _esc(text: str) -> str:
    return html.escape(text)


def _pre(text: str) -> str:
    return f"<pre>{_esc(text)}</pre>"


def _render(tasks, solutions, reviews, profile, roadmap, summary, attempts) -> str:
    parts: list[str] = []
    parts.append(
        "<html><head><meta charset='utf-8'>"
        "<title>Zero Knowledge — живой прогон</title>"
        "<style>"
        "body{font-family:Segoe UI,Arial,sans-serif;max-width:960px;margin:24px auto;"
        "padding:0 16px;color:#1f2328;background:#fafbfc}"
        "h1,h2{color:#0d1117} .card{background:#fff;border:1px solid #d0d7de;"
        "border-radius:8px;padding:16px;margin:16px 0}"
        ".badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:12px;"
        "font-weight:600;background:#dafbe1;color:#116329}"
        ".warn{background:#fff8c5;color:#9a6700} .muted{color:#59636e}"
        "pre{background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:12px;"
        "overflow:auto;font-size:13px;line-height:1.5}"
        "table{border-collapse:collapse;width:100%;font-size:14px}"
        "th,td{border:1px solid #d0d7de;padding:8px;text-align:left}"
        "th{background:#f6f8fa}"
        "li{margin:6px 0}"
        "</style></head><body>"
    )
    parts.append("<h1>Zero Knowledge — живой прогон (реальные данные)</h1>")
    parts.append(
        f"<p class='muted'>Сгенерировано: {time.strftime('%Y-%m-%d %H:%M:%S')} · "
        f"Попыток генерации задач: {attempts}</p>"
    )

    parts.append("<h2>1. Диагностические задачи (ZEROK-4 + ZEROK-3)</h2>")
    for index, task in enumerate(tasks, start=1):
        solution = next(s for s in solutions if s.task_id == task.id)
        parts.append("<div class='card'>")
        parts.append(
            f"<h3>Задача {index} — {_esc(task.difficulty.value.upper())}</h3>"
        )
        parts.append(f"<p><b>Навыки:</b> {_esc(', '.join(task.topic_ids) or '—')}</p>")
        parts.append(f"<p><b>Условие:</b></p>{_pre(task.statement)}")
        parts.append(f"<p><b>Эталонное решение:</b></p>{_pre(solution.code or '')}")
        parts.append(
            "<p><b>Прогон эталона в Docker-песочнице:</b> "
            "<span class='badge'>PASSED</span></p>"
        )
        parts.append("</div>")

    parts.append("<h2>2. Разбор решений студента (ZEROK-5)</h2>")
    for index, review in enumerate(reviews, start=1):
        assessment = review.assessment
        parts.append("<div class='card'>")
        parts.append(f"<h3>Решение {index}</h3>")
        correct = assessment.is_correct
        badge = "<span class='badge'>ВЕРНО</span>" if correct else "<span class='badge warn'>НЕВЕРНО</span>"
        parts.append(
            f"<p>{badge} · Самостоятельность: <b>{assessment.independence:.2f}</b> · "
            f"Понимание: <b>{assessment.understanding.value}</b></p>"
        )
        parts.append(
            f"<p class='muted'>Подсказок использовано: {len(assessment.hints_used)}</p>"
        )
        parts.append(f"<p class='muted'>{_esc(assessment.rationale)}</p>")
        if review.questions:
            parts.append("<p><b>Вопросы AI к решению:</b></p><ul>")
            for question in review.questions[:4]:
                parts.append(
                    f"<li><b>{_esc(question.kind.value)}</b>: {_esc(question.text)}</li>"
                )
            parts.append("</ul>")
        parts.append("</div>")

    parts.append("<h2>3. Профиль знаний (ZEROK-6)</h2>")
    parts.append("<div class='card'>")
    parts.append(f"<p><b>Резюме (LLM):</b> {_esc(summary)}</p>")
    parts.append("<table><tr><th>Навык</th><th>mastery</th><th>independence</th>"
                 "<th>evidence</th></tr>")
    for skill_id, assessment in sorted(profile.skills.items()):
        parts.append(
            f"<tr><td>{_esc(skill_id)}</td><td>{assessment.mastery.value}</td>"
            f"<td>{assessment.independence:.2f}</td><td>{assessment.evidence_count}</td></tr>"
        )
    parts.append("</table>")
    parts.append(f"<p><b>Сильные:</b> {_esc(', '.join(profile.strengths) or '—')}</p>")
    parts.append(f"<p><b>Слабые:</b> {_esc(', '.join(profile.weaknesses) or '—')}</p>")
    parts.append(
        f"<p><b>Нужно повторить:</b> {_esc(', '.join(profile.needs_review) or '—')}</p>"
    )
    parts.append("</div>")

    parts.append("<h2>4. Roadmap (ZEROK-6)</h2>")
    parts.append("<div class='card'>")
    parts.append(f"<p><b>Цель:</b> {_esc(roadmap.goal)}</p>")
    parts.append("<ol>")
    for step in roadmap.steps:
        parts.append(
            f"<li><b>{_esc(step.title)}</b> "
            f"<span class='muted'>({step.step_type.value}, {step.difficulty.value})</span>"
            f" — навыки: {_esc(', '.join(step.skill_ids) or '—')}</li>"
        )
    parts.append("</ol>")
    parts.append("<p><b>Объяснимые рекомендации:</b></p><ul>")
    for recommendation in roadmap.recommendations:
        parts.append(
            f"<li><b>{_esc(recommendation.action)}</b><br>"
            f"<span class='muted'>почему: {_esc(recommendation.rationale)}</span></li>"
        )
    parts.append("</ul></div>")

    parts.append("</body></html>")
    return "".join(parts)


def main() -> int:
    client = DeepSeekClient()
    runner = DockerIsolatedExecutionRunner()

    print("[1/4] Генерация трёх задач (DeepSeek + Docker)...")
    task_service = TaskBlockService(client, runner)
    task_set, tasks, solutions, tests = task_service.generate()
    print(f"      готово: {len(tasks)} задач, эталоны прошли тесты в песочнице")

    print("[2/4] Разбор решений студента (DeepSeek)...")
    solution_by_task: dict[UUID, ReferenceSolution] = {
        solution.task_id: solution for solution in solutions
    }
    review_service = SolutionReviewService(client)
    reviews = []
    outcomes: list[TaskOutcome] = []
    for index, task in enumerate(tasks):
        code = solution_by_task[task.id].code or ""
        answer = _student_answer(task, code)
        hints = _hints_for(task, index)
        review = review_service.review(task, answer, hints)
        reviews.append(review)
        outcomes.append(
            TaskOutcome(task=task, answer=answer, hints=hints, assessment=review.assessment)
        )
    print(f"      готово: {len(reviews)} разборов")

    print("[3/4] Построение профиля и roadmap (DeepSeek)...")
    profile_service = ProfileRoadmapService(client)
    result = profile_service.build(STUDENT_ID, GOAL, outcomes)
    print(f"      готово: навыков={len(result.profile.skills)}, "
          f"шагов={len(result.roadmap.steps)}, "
          f"рекомендаций={len(result.roadmap.recommendations)}")

    print("[4/4] Формирование HTML-отчёта...")
    html_text = _render(
        tasks,
        solutions,
        reviews,
        result.profile,
        result.roadmap,
        result.profile_summary,
        task_service.attempts_used,
    )
    OUTPUT.write_text(html_text, encoding="utf-8")
    print(f"      сохранено: {OUTPUT}")

    try:
        os.startfile(OUTPUT)
    except AttributeError:
        print(f"Откройте файл вручную: {OUTPUT}")
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
