"""Unit tests for the self-hosted code runner (no Docker needed).

The executor's status mapping, limit clamping and output truncation are pure;
the Docker boundary is mocked so the tests run everywhere.
"""

from types import SimpleNamespace
from unittest.mock import patch

from src.services.code_runner import executor


def _completed(returncode=0, stdout=b"", stderr=b""):
    return SimpleNamespace(returncode=returncode, stdout=stdout, stderr=stderr)


def test_exit_to_status_mapping():
    assert executor._exit_to_status(0) == (3, "Accepted")
    assert executor._exit_to_status(124) == (5, "Time Limit Exceeded")
    assert executor._exit_to_status(137) == (5, "Memory Limit Exceeded")
    assert executor._exit_to_status(139) == (7, "Runtime Error (SIGSEGV)")
    assert executor._exit_to_status(136) == (9, "Runtime Error (SIGFPE)")
    assert executor._exit_to_status(134) == (10, "Runtime Error (SIGABRT)")
    assert executor._exit_to_status(42) == (11, "Runtime Error (NZEC)")


def test_clamp_limits():
    assert executor._clamp_cpu(None) == 5.0
    assert executor._clamp_cpu(100.0) == 15.0
    assert executor._clamp_cpu(0.01) == 0.1
    assert executor._clamp_memory(None) == 128 * 1024
    assert executor._clamp_memory(999999) == 512 * 1024
    assert executor._clamp_memory(0) == 16
    # wall default is derived from cpu; explicit values are clamped to [1, 60]
    assert executor._clamp_wall(5.0, None) == 17.0
    assert executor._clamp_wall(5.0, 999.0) == 60.0


def test_truncate():
    assert executor._truncate(None) is None
    assert executor._truncate("abc") == "abc"
    big = "x" * (executor.MAX_OUTPUT_CHARS + 100)
    out = executor._truncate(big)
    assert out.endswith("[truncated 100 chars]")


def test_unknown_language():
    result = executor.execute(language_id=999, source_code="x")
    assert result["status"]["id"] == 14
    assert "not supported" in result["message"]


def test_python_accepted():
    with patch.object(executor, "_run_container", return_value=_completed(0, b"5\n", b"")):
        result = executor.execute(71, "print(2+3)")
    assert result["status"] == {"id": 3, "description": "Accepted"}
    assert result["stdout"] == "5\n"
    assert result["compile_output"] is None


def test_python_runtime_error():
    with patch.object(executor, "_run_container", return_value=_completed(11, b"", b"boom")):
        result = executor.execute(71, "x=1/0")
    assert result["status"]["id"] == 11
    assert result["stderr"] == "boom"


def test_python_time_limit():
    with patch.object(executor, "_run_container", return_value=_completed(124, b"", b"")):
        result = executor.execute(71, "while True: pass", cpu_time_limit=1)
    assert result["status"] == {"id": 5, "description": "Time Limit Exceeded"}


def test_cpp_compile_error():
    # C++ runs two containers: compile first, then run. Fail the first.
    with patch.object(
        executor, "_run_container", return_value=_completed(1, b"", b"error: expected '}'")
    ):
        result = executor.execute(54, "int main( {")
    assert result["status"]["id"] == 6
    assert "error" in result["compile_output"]


def test_cpp_accepted():
    # compile succeeds (returncode 0), run succeeds with stdout.
    calls = iter([_completed(0, b"", b""), _completed(0, b"7\n", b"")])
    with patch.object(executor, "_run_container", side_effect=lambda *a, **k: next(calls)):
        result = executor.execute(54, "#include <iostream>\nint main(){std::cout<<2+5;}")
    assert result["status"]["id"] == 3
    assert result["stdout"] == "7\n"


def test_memory_limit_reported_on_oom():
    with patch.object(executor, "_run_container", return_value=_completed(137, b"", b"")):
        result = executor.execute(71, "import sys; sys.exit(137)", memory_limit=65536)
    assert result["status"]["id"] == 5
    assert result["status"]["description"] == "Memory Limit Exceeded"
    assert result["memory"] == 65536
