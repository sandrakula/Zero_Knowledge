"""Spike: проверка подключения DeepSeek и структурированного JSON-вывода.

Прогоняет сценарии PoC против реального API DeepSeek и валидирует ответы
каноническими Pydantic-схемами проекта:

- ``tasks``      — генерация задач (канонические Task/ReferenceSolution/TestCase);
- ``questions``  — вопросы по решению студента (spike-схема);
- ``profile``    — профиль знаний (KnowledgeProfile);
- ``roadmap``    — персональный путь (Roadmap).

Запуск: ``py spikes/deepseek_api/run_check.py --all``
Требуется переменная окружения ``DEEPSEEK_API_KEY``.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

_SRC = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from zero_knowledge.llm import DeepSeekClient, DeepSeekJsonError
from zero_knowledge.schemas import KnowledgeProfile, Roadmap
from zero_knowledge.task_generation.errors import (
    GeneratedBlockInvalidError,
    ProviderUnavailableError,
)
from zero_knowledge.task_generation.prompt import build_task_generation_prompt
from zero_knowledge.task_generation.validation import parse_and_validate_block

STUDENT_ID = "00000000-0000-4000-8000-000000000001"
PROFILE_ID = "00000000-0000-4000-8000-000000000002"


class SolutionQuestion(BaseModel):
    """Один диагностический вопрос к решению студента (Socratic)."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., min_length=1, description="Идентификатор вопроса")
    kind: Literal[
        "understanding",
        "error_detection",
        "strategy",
        "transfer",
        "explanation",
        "calibration",
    ] = Field(..., description="Тип вопроса")
    text: str = Field(..., min_length=1, description="Текст вопроса")
    target: str = Field(default="", description="К чему относится (шаг/строка)")
    rationale: str = Field(default="", description="Зачем задан вопрос")


class SolutionQuestionnaire(BaseModel):
    """Вопросы к решению студента (spike-схема, каноническая — TBD)."""

    model_config = ConfigDict(extra="forbid")

    solution_summary: str = Field(..., min_length=1, description="Краткая оценка решения")
    questions: list[SolutionQuestion] = Field(default_factory=list)


def _schema_json(*models: type[BaseModel]) -> str:
    return json.dumps(
        {model.__name__: model.model_json_schema() for model in models},
        ensure_ascii=False,
        separators=(",", ":"),
    )


def build_profile_prompt(observations: str) -> str:
    return (
        f"Build a knowledge profile for student {STUDENT_ID} from the observations "
        f"below. Cover every skill mentioned with an 8-dimension SkillAssessment "
        f"(mastery, cognitive_depth, independence, application, transfer, retention, "
        f"process_quality, calibration) and include any active misconceptions.\n\n"
        f"Observations:\n{observations}\n\n"
        "Return exactly one JSON object and nothing else (no Markdown, no commentary) "
        "matching the canonical schema. Use the given student_id. Use only enum values "
        "from the schema.\nCanonical JSON Schema:\n"
        + _schema_json(KnowledgeProfile)
    )


def build_roadmap_prompt(goal: str, level_summary: str) -> str:
    return (
        f"Build a personal learning roadmap for student {STUDENT_ID}.\n"
        f"Goal: {goal}\n"
        f"Current level: {level_summary}\n\n"
        "Produce 4-6 ordered steps and 2-3 explainable recommendations. "
        "Return exactly one JSON object and nothing else (no Markdown, no commentary) "
        "matching the canonical schema. Use the given student_id and set "
        "based_on_profile_id to "
        f"{PROFILE_ID}. Use only enum values from the schema.\n"
        "Canonical JSON Schema:\n"
        + _schema_json(Roadmap)
    )


def build_questions_prompt(solution: str) -> str:
    return (
        "A student submitted the solution below. As a tutor, ask 3-5 diagnostic "
        "questions that help the student find and fix their own mistakes instead of "
        "handing them the answer. Do not reveal the solution.\n\n"
        f"Student solution:\n{solution}\n\n"
        "Return exactly one JSON object and nothing else (no Markdown, no commentary) "
        "matching the canonical schema.\nCanonical JSON Schema:\n"
        + _schema_json(SolutionQuestionnaire)
    )


_OBSERVATIONS = (
    "- Solved 6/10 easy recursion tasks correctly with no hints.\n"
    "- On medium tasks: 3/10 correct, asked for hints in 7 of them, mostly the "
    "full-explanation hint.\n"
    "- Confuses the base case of recursion with the loop exit condition.\n"
    "- Self-reported confidence was HIGH on 8/10 medium answers but only 3 were right.\n"
    "- In a transfer task (recursion on trees), failed to adapt the pattern.\n"
    "- Two weeks later, re-solved only 4/6 of the easy tasks it knew before."
)

_GOAL = "Prepare for a competitive-programming interview focused on recursion and trees."

_LEVEL_SUMMARY = (
    "Comfortable with basic loops and arrays; knows what recursion is but struggles "
    "with base cases and with applying recursion to trees."
)

_SOLUTION = (
    "def count_nodes(root):\n"
    "    if root is None:\n"
    "        return 0\n"
    "    else:\n"
    "        return 1 + count_nodes(root)\n"
)


def _validate_profile(data: dict[str, Any]) -> KnowledgeProfile:
    return KnowledgeProfile.model_validate(data)


def _validate_roadmap(data: dict[str, Any]) -> Roadmap:
    return Roadmap.model_validate(data)


def _validate_questions(data: dict[str, Any]) -> SolutionQuestionnaire:
    return SolutionQuestionnaire.model_validate(data)


def run_scenario(name: str, fn) -> dict[str, Any]:
    started = time.monotonic()
    try:
        value = fn()
        return {
            "scenario": name,
            "ok": True,
            "elapsed_s": round(time.monotonic() - started, 2),
            "summary": str(value)[:400],
        }
    except ProviderUnavailableError as exc:
        return {
            "scenario": name,
            "ok": False,
            "elapsed_s": round(time.monotonic() - started, 2),
            "error": "ProviderUnavailableError",
            "detail": str(exc),
        }
    except (DeepSeekJsonError, GeneratedBlockInvalidError, ValidationError) as exc:
        return {
            "scenario": name,
            "ok": False,
            "elapsed_s": round(time.monotonic() - started, 2),
            "error": type(exc).__name__,
            "detail": _short(exc),
        }


def _short(exc: Exception) -> str:
    text = str(exc)
    return text if len(text) <= 400 else text[:400] + "…"


def run_tasks(client: DeepSeekClient):
    raw = client.generate(build_task_generation_prompt())
    tasks, solutions, tests = parse_and_validate_block(raw)
    return {
        "tasks": len(tasks),
        "solutions": len(solutions),
        "tests": len(tests),
        "difficulties": [t.difficulty.value for t in tasks],
    }


def run_profile(client: DeepSeekClient):
    data = client.chat_json(build_profile_prompt(_OBSERVATIONS))
    profile = _validate_profile(data)
    return {"skills": list(profile.skills), "misconceptions": len(profile.misconceptions)}


def run_roadmap(client: DeepSeekClient):
    data = client.chat_json(build_roadmap_prompt(_GOAL, _LEVEL_SUMMARY))
    roadmap = _validate_roadmap(data)
    return {"steps": len(roadmap.steps), "recommendations": len(roadmap.recommendations)}


def run_questions(client: DeepSeekClient):
    data = client.chat_json(build_questions_prompt(_SOLUTION))
    questionnaire = _validate_questions(data)
    return {"questions": len(questionnaire.questions)}


def run_probe_json_schema(client: DeepSeekClient) -> dict[str, Any]:
    """Проверить, принимает ли DeepSeek строгий режим json_schema."""
    response_format = {
        "type": "json_schema",
        "json_schema": {
            "name": "probe",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {"value": {"type": "integer"}},
                "required": ["value"],
                "additionalProperties": False,
            },
        },
    }
    try:
        data = client.chat_json(
            "Return JSON with an integer field value=42.", response_format=response_format
        )
        return {"ok": True, "data": data}
    except (ProviderUnavailableError, DeepSeekJsonError) as exc:
        return {"ok": False, "error": type(exc).__name__, "detail": str(exc)[:300]}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true", help="run all four scenarios")
    parser.add_argument("--scenario", choices=["tasks", "questions", "profile", "roadmap"])
    parser.add_argument("--probe-json-schema", action="store_true")
    args = parser.parse_args()

    client = DeepSeekClient()
    scenarios = {
        "tasks": lambda: run_tasks(client),
        "questions": lambda: run_questions(client),
        "profile": lambda: run_profile(client),
        "roadmap": lambda: run_roadmap(client),
    }

    try:
        if args.probe_json_schema:
            print(json.dumps(run_probe_json_schema(client), ensure_ascii=False, indent=2))
            return
        names = list(scenarios) if args.all else [args.scenario]
        if not names:
            parser.error("specify --all or --scenario <name>")
        results = []
        for name in names:
            result = run_scenario(name, scenarios[name])
            results.append(result)
            print(json.dumps(result, ensure_ascii=False, indent=2))
        ok = all(r["ok"] for r in results)
        print(f"\nRESULT: {'ALL OK' if ok else 'FAILURES'} ({sum(r['ok'] for r in results)}/{len(results)})")
        sys.exit(0 if ok else 1)
    finally:
        client.close()


if __name__ == "__main__":
    main()
