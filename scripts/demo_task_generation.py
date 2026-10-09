"""Run the real ZEROK-1 -> ZEROK-4 -> ZEROK-2 -> ZEROK-3 pipeline."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from zero_knowledge.execution import DockerIsolatedExecutionRunner
from zero_knowledge.llm import DeepSeekClient
from zero_knowledge.task_generation import (
    AttemptsExhaustedError,
    IsolatedExecutionUnavailableError,
    ProviderUnavailableError,
    TaskBlockService,
    UnavailableExecutionRunner,
)


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate and validate three Python tasks with ZEROK."
    )
    parser.add_argument(
        "--preview",
        action="store_true",
        help="validate generated data without executing reference solutions",
    )
    return parser.parse_args()


def main() -> int:
    arguments = _arguments()
    client = DeepSeekClient()
    runner = (
        UnavailableExecutionRunner()
        if arguments.preview
        else DockerIsolatedExecutionRunner()
    )
    service = TaskBlockService(client, runner)

    try:
        if arguments.preview:
            preview = service.generate_without_reference_execution()
            task_set = preview.task_set
            tasks = preview.tasks
            solutions = preview.solutions
            tests = preview.tests
            verified = False
        else:
            task_set, tasks, solutions, tests = service.generate()
            verified = True
    except ProviderUnavailableError as error:
        print(f"DeepSeek generation unavailable: {error}", file=sys.stderr)
        print(
            "Set DEEPSEEK_API_KEY and the ZEROK-1 endpoint variables described "
            "in .env.example.",
            file=sys.stderr,
        )
        return 2
    except AttemptsExhaustedError as error:
        print(f"Generated content did not pass validation: {error}", file=sys.stderr)
        print(f"Attempts used: {service.attempts_used}", file=sys.stderr)
        return 3
    except IsolatedExecutionUnavailableError as error:
        print(f"ZEROK-3 isolated execution unavailable: {error}", file=sys.stderr)
        print(
            "Build/start the Docker sandbox described in docs/zerok-3.md.",
            file=sys.stderr,
        )
        return 4
    finally:
        client.close()

    solutions_by_task = {solution.task_id: solution for solution in solutions}
    tests_by_id = {case.id: case for case in tests}

    for task in tasks:
        solution = solutions_by_task[task.id]
        linked_tests = [tests_by_id[test_id] for test_id in task.test_ids]
        print(f"\n=== {task.difficulty.value.upper()} ===")
        print(f"\nTitle: {task.title}")
        print(f"\nTask:\n{task.statement}")
        print(f"\nReference solution:\n{solution.code}")
        print(f"\nTests: {len(linked_tests)}")
        for number, case in enumerate(linked_tests, start=1):
            print(f"{number}. input: {case.input_data!r}")
            print(f"   expected: {case.expected_output!r}")
        if verified:
            print("\nReference execution: PASSED")
            print(f"Passed: {len(linked_tests)}/{len(linked_tests)}")
        else:
            print("\nReference execution: NOT RUN")
            print(f"Reason: {preview.reason}")

    print("\n========================")
    print("Generation: SUCCESS")
    print("Schema validation: SUCCESS")
    print("Difficulty validation: SUCCESS")
    print(f"Reference execution: {'SUCCESS' if verified else 'NOT RUN'}")
    print(f"TaskSet status: {'VERIFIED' if verified else 'UNVERIFIED'}")
    print(f"TaskSet id: {task_set.id}")
    print(f"Attempts used: {service.attempts_used}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
