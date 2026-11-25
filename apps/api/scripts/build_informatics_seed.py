#!/usr/bin/env python3
"""Build the bundled informatics course bundle from the informatics.msk.ru data.

The bundle that ships with the API (``src/services/setup/informatics_seed.json``)
is generated from the public course map plus the scraped problem payloads:

    python scripts/build_informatics_seed.py \
        --topics C:/_audit/data/informatics/topics.json \
        --raw    C:/_audit/data/informatics/raw \
        --out    src/services/setup/informatics_seed.json

Each statement set becomes one CODE module; every problem in it becomes one C++
task. Problems without public sample tests, without a C++ implementation, or
marked ``output_only`` (file-submission / test-design tasks) are skipped: a task
the local judge cannot grade is worse than a missing one.

Already-curated tasks from the 20/80 seed can be reused with ``--curated`` so
the hand-written statements of the first two topics are kept verbatim.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

CPP_STARTER = """#include <iostream>
using namespace std;

int main() {
    // Прочитайте входные данные и выведите ответ
    
    return 0;
}
"""

SKIP_DIV_CLASSES = {"header", "sample-tests", "sample-test"}


class _MarkdownConverter(HTMLParser):
    """Small, dependency-free HTML -> Markdown converter for problem statements.

    Only the constructs the statements actually use are handled: paragraphs,
    headings, emphasis, inline code, pre blocks, lists, links, images, tables
    and the ``section-title`` helper div. Scripts, styles and the duplicated
    header/sample-test blocks are dropped.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip_tag = 0
        self.pre = 0
        self.div_depth = 0
        self.skip_div_depth: int | None = None
        self.section_title_depth: int | None = None
        self.list_stack: list[str] = []
        self.list_counter: list[int] = []
        self.href: str | None = None
        self.table_rows: list[list[str]] | None = None
        self.table_row: list[str] | None = None
        self.table_cell: list[str] | None = None
        self.table_header: bool = False

    # -- helpers ---------------------------------------------------------
    def _add(self, value: str) -> None:
        value = value.replace("\r\n", "\n").replace("\r", "\n").replace("\u00a0", " ")
        if self.table_cell is not None:
            self.table_cell.append(value)
        else:
            self.parts.append(value)

    def text(self) -> str:
        raw = "".join(self.parts)
        raw = unescape(raw)
        # Normalize the prose around fenced code blocks without touching code.
        chunks = re.split(r"(```[\s\S]*?```)", raw)
        normalized: list[str] = []
        for chunk in chunks:
            if chunk.startswith("```"):
                normalized.append(chunk)
                continue
            prose = re.sub(r"[ \t]+", " ", chunk)
            prose = re.sub(r" *\n *", "\n", prose)
            prose = re.sub(r"\n{3,}", "\n\n", prose)
            normalized.append(prose)
        return "".join(normalized).strip()

    # -- HTMLParser ------------------------------------------------------
    def handle_starttag(self, tag: str, attrs) -> None:
        attributes = dict(attrs)
        if tag in {"script", "style"}:
            self.skip_tag += 1
            return
        if self.skip_tag:
            return

        if tag == "div":
            self.div_depth += 1
            classes = set((attributes.get("class") or "").split())
            if self.skip_div_depth is None and classes & SKIP_DIV_CLASSES:
                self.skip_div_depth = self.div_depth
                return
            if "section-title" in classes and self.skip_div_depth is None:
                self.section_title_depth = self.div_depth
                self._add("\n\n### ")
                return

        if self.skip_div_depth is not None:
            return

        if self.pre:
            if tag == "br":
                self._add("\n")
            return

        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            level = int(tag[1]) + 1
            self._add("\n\n" + "#" * min(level, 6) + " ")
        elif tag == "p":
            self._add("\n\n")
        elif tag == "br":
            self._add("\n")
        elif tag == "pre":
            self.pre = 1
            self._add("\n\n```text\n")
        elif tag in {"strong", "b"}:
            self._add("**")
        elif tag in {"em", "i"}:
            self._add("*")
        elif tag == "code":
            self._add("`")
        elif tag == "ul":
            self.list_stack.append("ul")
            self.list_counter.append(0)
            self._add("\n")
        elif tag == "ol":
            self.list_stack.append("ol")
            self.list_counter.append(0)
            self._add("\n")
        elif tag == "li":
            if self.list_stack:
                indent = "  " * (len(self.list_stack) - 1)
                if self.list_stack[-1] == "ol":
                    self.list_counter[-1] += 1
                    marker = f"{self.list_counter[-1]}. "
                else:
                    marker = "- "
                self._add(f"\n{indent}{marker}")
        elif tag == "a":
            self.href = attributes.get("href")
            self._add("[")
        elif tag == "img":
            src = attributes.get("src") or ""
            if src.startswith("/"):
                src = "https://informatics.msk.ru" + src
            alt = (attributes.get("alt") or "").replace("]", "")
            self._add(f"![{alt}]({src})")
        elif tag == "sup":
            self._add("^")
        elif tag == "sub":
            self._add("_")
        elif tag == "table":
            self.table_rows = []
            self._add("\n\n")
        elif tag == "tr":
            self.table_row = []
        elif tag in {"td", "th"}:
            self.table_cell = []
            self.table_header = self.table_header or tag == "th"
        elif tag == "blockquote":
            self._add("\n\n> ")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"}:
            self.skip_tag = max(0, self.skip_tag - 1)
            return
        if self.skip_tag:
            return

        if tag == "div":
            if self.section_title_depth is not None and self.div_depth == self.section_title_depth:
                self._add("\n\n")
                self.section_title_depth = None
            if self.skip_div_depth is not None and self.div_depth == self.skip_div_depth:
                self.skip_div_depth = None
            self.div_depth = max(0, self.div_depth - 1)
            return
        if self.skip_div_depth is not None:
            return

        if self.pre:
            if tag == "pre":
                self.pre = 0
                self._add("\n```\n\n")
            return

        if tag in {"h1", "h2", "h3", "h4", "h5", "h6", "p"}:
            self._add("\n\n")
        elif tag in {"strong", "b"}:
            self._add("**")
        elif tag in {"em", "i"}:
            self._add("*")
        elif tag == "code":
            self._add("`")
        elif tag in {"ul", "ol"}:
            if self.list_stack:
                self.list_stack.pop()
                self.list_counter.pop()
            self._add("\n")
        elif tag == "a":
            href = self.href or ""
            self.href = None
            self._add(f"]({href})" if href else "]")
        elif tag in {"td", "th"}:
            if self.table_row is not None and self.table_cell is not None:
                cell = re.sub(r"\s+", " ", "".join(self.table_cell)).strip()
                self.table_row.append(cell)
            self.table_cell = None
        elif tag == "tr":
            if self.table_rows is not None and self.table_row is not None:
                self.table_rows.append(self.table_row)
            self.table_row = None
        elif tag == "table":
            rows = self.table_rows or []
            if rows:
                width = max(len(row) for row in rows)
                rows = [row + [""] * (width - len(row)) for row in rows]
                head, body = rows[0], rows[1:]
                self._add("\n\n| " + " | ".join(head) + " |\n")
                self._add("|" + "|".join(["---"] * width) + "|\n")
                for row in body:
                    self._add("| " + " | ".join(row) + " |\n")
                self._add("\n")
            self.table_rows = None
        elif tag == "blockquote":
            self._add("\n\n")

    def handle_data(self, data: str) -> None:
        if self.skip_tag or self.skip_div_depth is not None:
            return
        if self.pre:
            self._add(unescape(data))
            return
        if self.section_title_depth is not None and self.table_cell is None:
            title = re.sub(r"\s+", " ", data).strip()
            if title:
                self._add(title)
            return
        if self.table_cell is None and not data.strip():
            return
        self._add(data)


def html_to_markdown(html: str) -> str:
    parser = _MarkdownConverter()
    parser.feed(html or "")
    parser.close()
    text = parser.text()
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


class _PreExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_pre = False
        self.values: list[str] = []
        self.buffer: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag == "pre":
            self.in_pre = True
            self.buffer = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "pre" and self.in_pre:
            self.values.append("".join(self.buffer).strip("\r\n"))
            self.in_pre = False

    def handle_data(self, data: str) -> None:
        if self.in_pre:
            self.buffer.append(data)


def sample_tests(html: str) -> list[dict[str, Any]]:
    parser = _PreExtractor()
    parser.feed(html or "")
    parser.close()
    values = parser.values
    tests: list[dict[str, Any]] = []
    for index in range(0, len(values) - 1, 2):
        expected = values[index + 1]
        # Some source pages ship an empty <pre> for the expected output. A task
        # with no expected output cannot be graded, so keep only real samples.
        if not expected.strip():
            continue
        tests.append(
            {
                "id": f"sample_{index // 2 + 1}",
                "label": f"Пример {index // 2 + 1}",
                "stdin": values[index],
                "expectedStdout": expected,
                "hidden": False,
                "weight": 1,
            }
        )
    return tests


def _has_cpp(payload: dict[str, Any]) -> bool:
    for language in payload.get("languages") or []:
        name = (language.get("name") or "").lower()
        if name.startswith(("gnu c++", "g++", "c++")):
            return True
    return False


def _limits(payload: dict[str, Any]) -> tuple[int | None, int | None]:
    time_ms = None
    memory_kb = None
    try:
        if payload.get("timelimit") is not None:
            time_ms = max(100, int(float(payload["timelimit"]) * 1000))
    except (TypeError, ValueError):
        pass
    try:
        if payload.get("memorylimit") is not None:
            memory_kb = max(1024, int(payload["memorylimit"]) // 1024)
    except (TypeError, ValueError):
        pass
    return time_ms, memory_kb


def _description(problem_id: int, payload: dict[str, Any]) -> str:
    title = str(payload.get("name") or "").strip()
    body = html_to_markdown(str(payload.get("content") or ""))

    # Give the legend a heading and keep the rest as sections. Some problems
    # have no legend at all (the whole statement is in input/output), so the
    # "Условие" heading is omitted instead of rendering an empty section.
    marker = "### Входные данные"
    if marker in body:
        head, tail = body.split(marker, 1)
        head = head.strip()
        prefix = f"### Условие\n\n{head}\n\n" if head else ""
        body = prefix + marker + tail
    else:
        condition = body.strip()
        body = f"### Условие\n\n{condition}" if condition else ""

    tests = sample_tests(str(payload.get("sample_tests_html") or ""))
    examples: list[str] = []
    for index, test in enumerate(tests, start=1):
        examples.append(f"**Пример {index}**")
        examples.append("**Входные данные**")
        examples.append("```text\n" + test["stdin"].strip("\n") + "\n```")
        examples.append("**Выходные данные**")
        examples.append("```text\n" + test["expectedStdout"].strip("\n") + "\n```")
    examples_md = "\n\n".join(examples)

    return (
        f"## {title}\n\n"
        f"{body.strip()}\n\n"
        f"### Примеры\n\n{examples_md}\n\n"
        f"---\n"
        f"Источник: [informatics.msk.ru](https://informatics.msk.ru/py/problem/{problem_id})\n"
    )


def build_task(
    problem_id: int,
    payload: dict[str, Any],
    curated: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    title = str(payload.get("name") or "").strip() or f"Задача {problem_id}"
    task_title = f"informatics.msk.ru №{problem_id}. {title}"

    tests: list[dict[str, Any]] = []
    if curated is not None:
        description = curated.get("description") or _description(problem_id, payload)
        contents = curated.get("contents") or {}
        contents = json.loads(json.dumps(contents)) if not isinstance(contents, dict) else dict(contents)
        tests = [
            test
            for test in contents.get("test_cases") or []
            if (test.get("expectedStdout") or "").strip()
        ]
    else:
        description = _description(problem_id, payload)
        contents = {}

    if not tests:
        tests = sample_tests(str(payload.get("sample_tests_html") or ""))
    if not tests:
        return None
    contents["test_cases"] = tests

    time_ms, memory_kb = _limits(payload)
    contents.update(
        {
            "language_id": 54,
            "languages": [54],
            "grading_mode": contents.get("grading_mode") or "equal_weight",
            "starter_code": contents.get("starter_code") or CPP_STARTER,
            "solution_code": "",
            "allow_student_run": True,
            "show_hidden_test_count": True,
            "require_passing_to_submit": True,
            "show_test_details_on_fail": True,
            "show_solution_after_submit": False,
        }
    )
    if time_ms is not None:
        contents["time_limit_ms"] = time_ms
    if memory_kb is not None:
        contents["memory_limit_kb"] = memory_kb

    meta = dict(contents.get("_meta") or {})
    meta.setdefault("sources", ["informatics.msk.ru"])
    meta.setdefault("ai_generated", False)
    meta["problem_id"] = problem_id
    contents["_meta"] = meta

    return {
        "key": f"problem-{problem_id}",
        "title": task_title,
        "description": description,
        "hint": "",
        "assignment_type": "CODE",
        "max_grade_value": 100,
        "contents": contents,
    }


def _load_curated(path: Path | None) -> dict[int, dict[str, Any]]:
    if path is None or not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    curated: dict[int, dict[str, Any]] = {}
    for chapter in data.get("chapters") or []:
        for activity in chapter.get("activities") or []:
            assignment = activity.get("assignment") or {}
            for task in assignment.get("tasks") or []:
                match = re.search(r"№\s*(\d+)", task.get("title") or "")
                if match:
                    curated[int(match.group(1))] = task
    return curated


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--topics", required=True, help="topics.json from the collected dataset")
    parser.add_argument("--raw", required=True, help="Directory with <problem_id>.json payloads")
    parser.add_argument("--out", required=True, help="Output bundle path")
    parser.add_argument("--skeleton", help="Existing bundle whose course/chapter outline is preserved")
    parser.add_argument("--curated", help="Optional 20/80 seed whose tasks are reused verbatim")
    args = parser.parse_args()

    topics = json.loads(Path(args.topics).read_text(encoding="utf-8"))
    raw_dir = Path(args.raw)
    curated = _load_curated(Path(args.curated) if args.curated else None)

    skeleton = None
    if args.skeleton and Path(args.skeleton).exists():
        skeleton = json.loads(Path(args.skeleton).read_text(encoding="utf-8"))

    chapters: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    used: set[int] = set()

    for chapter_index, (topic_key, groups) in enumerate(topics.items()):
        match = re.match(r"^(\d+):\s*(.*)$", topic_key)
        topic_id = int(match.group(1)) if match else chapter_index
        topic_name = (match.group(2) if match else topic_key).strip()

        activities: list[dict[str, Any]] = []
        for set_index, (set_name, problem_ids) in enumerate(groups.items()):
            activity_key = f"t{topic_id}-s{set_index + 1}"
            tasks: list[dict[str, Any]] = []
            for problem_id in problem_ids:
                used.add(problem_id)
                payload_path = raw_dir / f"{problem_id}.json"
                if not payload_path.exists():
                    skipped.append({"problem_id": problem_id, "reason": "missing raw payload"})
                    continue
                payload = json.loads(payload_path.read_text(encoding="utf-8"))
                if payload.get("output_only"):
                    skipped.append({"problem_id": problem_id, "reason": "output-only task"})
                    continue
                if not _has_cpp(payload):
                    skipped.append({"problem_id": problem_id, "reason": "no C++ implementation"})
                    continue
                if not sample_tests(str(payload.get("sample_tests_html") or "")):
                    skipped.append({"problem_id": problem_id, "reason": "no public sample tests"})
                    continue
                task = build_task(problem_id, payload, curated.get(problem_id))
                if task is None:
                    skipped.append(
                        {"problem_id": problem_id, "reason": "no usable sample tests"}
                    )
                    continue
                tasks.append(task)

            activities.append(
                {
                    "key": activity_key,
                    "name": set_name,
                    "activity_type": "TYPE_ASSIGNMENT",
                    "activity_sub_type": "SUBTYPE_ASSIGNMENT_ANY",
                    "content": {},
                    "details": {},
                    "extra_metadata": {
                        "informatics": {"topic_id": topic_id, "activity_key": activity_key}
                    },
                    "assignment": {
                        "title": set_name,
                        "description": "",
                        "grading_type": "PERCENTAGE",
                        "auto_grading": True,
                        "published": True,
                        "tasks": tasks,
                    },
                }
            )

        chapters.append(
            {
                "key": f"topic-{topic_id}",
                "topic_id": topic_id,
                "name": topic_name,
                "description": "",
                "extra_metadata": {
                    "informatics": {"topic_id": topic_id, "chapter_key": f"topic-{topic_id}"}
                },
                "activities": activities,
            }
        )

    course = {
        "name": "Информатика",
        "description": (
            "Курс по информатике на основе программы informatics.msk.ru: "
            "23 темы от ввода-вывода и условий до алгоритмов и структур данных."
        ),
        "about": (
            "Задачи из программы informatics.msk.ru с публичными примерами. "
            "Проверка решений идёт через локальный судья."
        ),
        "learnings": "Основы C++, алгоритмы и структуры данных, олимпиадное программирование.",
        "tags": "информатика, C++, алгоритмы",
        "public": True,
        "published": True,
        "extra_metadata": {"seed": "informatics", "schema_version": 1, "version": 2},
    }
    if skeleton and skeleton.get("course"):
        course = {**skeleton["course"], **course}

    version = 2
    if skeleton and skeleton.get("version"):
        version = int(skeleton["version"]) + 1

    bundle = {
        "schema_version": 1,
        "seed": "informatics",
        "version": version,
        "source": "informatics.msk.ru",
        "course": course,
        "chapters": chapters,
    }

    out_path = Path(args.out)
    out_path.write_text(
        json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    modules = [activity for chapter in chapters for activity in chapter["activities"]]
    task_count = sum(len(activity["assignment"]["tasks"]) for activity in modules)
    test_count = sum(
        len(task["contents"].get("test_cases") or [])
        for activity in modules
        for task in activity["assignment"]["tasks"]
    )
    empty = [activity["name"] for activity in modules if not activity["assignment"]["tasks"]]

    print(f"Wrote {out_path} ({out_path.stat().st_size} bytes)")
    print(f"  chapters:   {len(chapters)}")
    print(f"  modules:    {len(modules)} ({len(modules) - len(empty)} with tasks)")
    print(f"  tasks:      {task_count}")
    print(f"  tests:      {test_count}")
    print(f"  unique ids: {len(used)}")
    if empty:
        print("  modules without gradable tasks:")
        for name in empty:
            print(f"    - {name}")
    if skipped:
        print(f"  skipped problems: {len(skipped)}")
        for item in skipped[:10]:
            print(f"    - {item['problem_id']}: {item['reason']}")
        if len(skipped) > 10:
            print(f"    ... and {len(skipped) - 10} more")
    return 0


if __name__ == "__main__":
    sys.exit(main())
