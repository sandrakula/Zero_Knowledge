"""Интеграционные тесты ZEROK-3 (требуют Docker и собранный sandbox-образ).

Тесты реально проверяют изоляцию, а не только интерфейс:

- корректное исполнение и stdin→stdout;
- сеть заблокирована;
- файловая система только на чтение;
- host-файлы не видны (изолированный tmpfs вместо host ``/tmp``);
- код исполняется не от root;
- таймаут останавливает зависший код;
- лимит памяти не даёт процессу выйти за пределы;
- ``verify_reference`` принимает верное эталонное решение и отклоняет неверное.

Если Docker недоступен или образ не удалось собрать, весь модуль пропускается.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path

import pytest

from zero_knowledge.execution import (
    DockerIsolatedExecutionRunner,
    DockerSandbox,
)
from zero_knowledge.schemas import (
    CognitiveDepth,
    Difficulty,
    Discipline,
    ReferenceSolution,
    Task,
    TaskType,
)
from zero_knowledge.schemas import TestCase as ZkTestCase
from zero_knowledge.task_generation import TaskBlockService
from zero_knowledge.task_generation.errors import (
    IsolatedExecutionUnavailableError,
    ReferenceSolutionFailedError,
)

ROOT = Path(__file__).resolve().parent.parent
IMAGE = os.environ.get("ZK_SANDBOX_IMAGE", "zero-knowledge/sandbox:latest")


def _docker_available() -> bool:
    if shutil.which("docker") is None:
        return False
    try:
        subprocess.run(
            ["docker", "version"], capture_output=True, timeout=10, check=True
        )
        return True
    except (OSError, subprocess.SubprocessError):
        return False


def _ensure_image() -> bool:
    """Вернуть True, если образ доступен или успешно собран."""

    inspect = subprocess.run(
        ["docker", "image", "inspect", IMAGE],
        capture_output=True,
        timeout=30,
        check=False,
    )
    if inspect.returncode == 0:
        return True
    build = subprocess.run(
        ["docker", "build", "-t", IMAGE, str(ROOT / "infra" / "sandbox")],
        capture_output=True,
        timeout=600,
        check=False,
    )
    return build.returncode == 0


pytestmark = pytest.mark.skipif(
    not _docker_available(), reason="docker is not available"
)


@pytest.fixture(scope="session")
def sandbox() -> DockerSandbox:
    if not _ensure_image():
        pytest.skip(f"sandbox image {IMAGE} is not available and could not be built")
    return DockerSandbox()


def test_simple_program_reads_stdin_and_writes_stdout(sandbox: DockerSandbox) -> None:
    result = sandbox.execute(
        "import sys\nprint(int(sys.stdin.read()) + 1)\n", input_data="41\n"
    )

    assert result.timed_out is False
    assert result.exit_code == 0
    assert result.stdout.strip() == "42"


def test_network_access_is_blocked(sandbox: DockerSandbox) -> None:
    source = (
        "import socket\n"
        "s = socket.socket()\n"
        "s.settimeout(3)\n"
        "s.connect(('8.8.8.8', 53))\n"
        "print('CONNECTED')\n"
    )

    result = sandbox.execute(source)

    assert result.timed_out is False
    assert result.exit_code != 0
    assert "CONNECTED" not in result.stdout


def test_filesystem_is_read_only(sandbox: DockerSandbox) -> None:
    source = (
        "try:\n"
        "    open('/work/probe.txt', 'w').write('x')\n"
        "    print('WROTE_WORK')\n"
        "except OSError:\n"
        "    print('BLOCKED_WORK')\n"
        "try:\n"
        "    open('/etc/zk-probe.txt', 'w').write('x')\n"
        "    print('WROTE_ETC')\n"
        "except OSError:\n"
        "    print('BLOCKED_ETC')\n"
    )

    result = sandbox.execute(source)

    assert result.exit_code == 0
    assert "WROTE_WORK" not in result.stdout
    assert "WROTE_ETC" not in result.stdout
    assert "BLOCKED_WORK" in result.stdout
    assert "BLOCKED_ETC" in result.stdout


def test_host_tmp_files_are_not_visible(sandbox: DockerSandbox) -> None:
    secret_name = f"zk-host-secret-{uuid.uuid4().hex}.txt"
    secret_path = Path(tempfile.gettempdir()) / secret_name
    secret_path.write_text("TOP_SECRET_HOST_TOKEN", encoding="utf-8")
    try:
        source = (
            "from pathlib import Path\n"
            f"p = Path('/tmp/{secret_name}')\n"
            "print('FOUND:' + p.read_text() if p.exists() else 'NOT_FOUND')\n"
        )

        result = sandbox.execute(source)

        assert result.exit_code == 0
        assert "TOP_SECRET_HOST_TOKEN" not in result.stdout
        assert "NOT_FOUND" in result.stdout
    finally:
        secret_path.unlink(missing_ok=True)


def test_code_runs_as_non_root(sandbox: DockerSandbox) -> None:
    result = sandbox.execute("import os\nprint(os.getuid())\nprint(os.geteuid())\n")

    assert result.exit_code == 0
    lines = result.stdout.splitlines()
    assert len(lines) >= 2
    assert lines[0] != "0"
    assert lines[1] != "0"


def test_timeout_kills_infinite_loop(sandbox: DockerSandbox) -> None:
    result = sandbox.execute("while True:\n    pass\n", timeout=2)

    assert result.timed_out is True
    assert result.exit_code is None


def test_memory_limit_is_enforced(sandbox: DockerSandbox) -> None:
    source = "data = bytearray(64 * 1024 * 1024)\nprint('ALLOCATED')\n"

    result = sandbox.execute(source, memory="32m")

    assert result.timed_out is False
    assert result.exit_code != 0
    assert "ALLOCATED" not in result.stdout


def _make_task() -> Task:
    return Task(
        title="integration",
        discipline=Discipline.PROGRAMMING,
        task_type=TaskType.PROGRAMMING,
        statement="echo stdin",
        difficulty=Difficulty.EASY,
        cognitive_depth=CognitiveDepth.APPLICATION,
    )


def test_verify_reference_accepts_correct_solution(sandbox: DockerSandbox) -> None:
    runner = DockerIsolatedExecutionRunner(sandbox)
    task = _make_task()
    solution = ReferenceSolution(
        task_id=task.id,
        approach="echo",
        final_answer="input",
        code="import sys\nsys.stdout.write(sys.stdin.read())\n",
    )
    case = ZkTestCase(
        task_id=task.id,
        input_data="hello\n",
        expected_output="hello\n",
        order=0,
    )

    runner.verify_reference(task, solution, [case])


def test_verify_reference_rejects_wrong_solution(sandbox: DockerSandbox) -> None:
    runner = DockerIsolatedExecutionRunner(sandbox)
    task = _make_task()
    solution = ReferenceSolution(
        task_id=task.id,
        approach="wrong",
        final_answer="constant",
        code="print('wrong')\n",
    )
    case = ZkTestCase(
        task_id=task.id,
        input_data="hello\n",
        expected_output="hello\n",
        order=0,
    )

    with pytest.raises(ReferenceSolutionFailedError):
        runner.verify_reference(task, solution, [case])


def test_verify_reference_rejects_crash(sandbox: DockerSandbox) -> None:
    runner = DockerIsolatedExecutionRunner(sandbox)
    task = _make_task()
    solution = ReferenceSolution(
        task_id=task.id,
        approach="crash",
        final_answer="boom",
        code="raise RuntimeError('boom')\n",
    )
    case = ZkTestCase(
        task_id=task.id,
        input_data="",
        expected_output="",
        order=0,
    )

    with pytest.raises(ReferenceSolutionFailedError):
        runner.verify_reference(task, solution, [case])


def test_missing_image_reports_sandbox_unavailable() -> None:
    sandbox = DockerSandbox(image="zero-knowledge/sandbox:definitely-missing")
    task = _make_task()
    solution = ReferenceSolution(
        task_id=task.id,
        approach="echo",
        final_answer="input",
        code="print('ok')\n",
    )
    case = ZkTestCase(task_id=task.id, input_data="", expected_output="ok\n")

    with pytest.raises(IsolatedExecutionUnavailableError):
        DockerIsolatedExecutionRunner(sandbox).verify_reference(task, solution, [case])


def _make_valid_block_payload() -> str:
    tasks: list[dict[str, object]] = []
    solutions: list[dict[str, object]] = []
    tests: list[dict[str, object]] = []

    for difficulty in ("easy", "medium", "hard"):
        task_id = str(uuid.uuid4())
        solution_id = str(uuid.uuid4())
        test_id = str(uuid.uuid4())
        tasks.append(
            {
                "id": task_id,
                "title": f"echo {difficulty}",
                "discipline": "programming",
                "task_type": "programming",
                "statement": "Read stdin and print it back.",
                "difficulty": difficulty,
                "cognitive_depth": "application",
                "solution_id": solution_id,
                "test_ids": [test_id],
                "metadata": {"language": "python"},
            }
        )
        solutions.append(
            {
                "id": solution_id,
                "task_id": task_id,
                "approach": "echo",
                "final_answer": "stdin",
                "code": "import sys\nsys.stdout.write(sys.stdin.read())\n",
            }
        )
        tests.append(
            {
                "id": test_id,
                "task_id": task_id,
                "description": "echo",
                "input_data": "7\n",
                "expected_output": "7\n",
                "order": 0,
            }
        )

    return json.dumps({"tasks": tasks, "solutions": solutions, "tests": tests})


class _SingleResponseProvider:
    def __init__(self, response: str) -> None:
        self._response = response

    def generate(self, prompt: str) -> str:
        del prompt
        return self._response


def test_task_block_service_integrates_with_real_runner(
    sandbox: DockerSandbox,
) -> None:
    service = TaskBlockService(
        _SingleResponseProvider(_make_valid_block_payload()),
        DockerIsolatedExecutionRunner(sandbox),
        max_attempts=2,
    )

    task_set, tasks, solutions, tests = service.generate()

    assert [task.difficulty.value for task in tasks] == ["easy", "medium", "hard"]
    assert len(solutions) == 3
    assert len(tests) == 3
    assert [item.task_id for item in task_set.items] == [task.id for task in tasks]
