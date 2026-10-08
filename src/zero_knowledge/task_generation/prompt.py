"""Prompt construction based on the canonical ZEROK-2 schemas."""

from __future__ import annotations

import json

from zero_knowledge.schemas import ReferenceSolution, Task, TestCase


def build_task_generation_prompt() -> str:
    """Build the ZEROK-4 prompt without maintaining duplicate field lists."""

    schemas = {
        "Task": Task.model_json_schema(),
        "ReferenceSolution": ReferenceSolution.model_json_schema(),
        "TestCase": TestCase.model_json_schema(),
    }
    return (
        "Generate exactly three Python programming tasks in this order: easy, medium, hard. "
        "Return one JSON object and no Markdown or explanatory text. The object must have "
        "exactly the keys tasks, solutions, tests; each value is an array of objects matching "
        "the supplied canonical schemas. Use valid UUIDs and preserve relationships: every "
        "Task.solution_id references its one ReferenceSolution.id; every Task.test_ids entry "
        "references a TestCase.id; related ReferenceSolution.task_id and TestCase.task_id must "
        "reference the Task.id. Every task must use task_type='programming', set "
        "metadata.language='python', have a non-blank statement, one non-blank reference code, "
        "and at least one meaningful input/output test. Difficulty values must be exactly easy, "
        "medium, hard, once each. Reference code reads stdin and writes stdout according to tests.\n"
        "Canonical ZEROK-2 JSON Schemas:\n"
        + json.dumps(schemas, ensure_ascii=False, separators=(",", ":"))
    )
