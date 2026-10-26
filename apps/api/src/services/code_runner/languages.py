"""Language table for the self-hosted code runner.

Each entry maps a Judge0 language id to a Docker image and the commands used to
compile (optional) and run a program. ``{main}`` is the absolute path of the
source file inside the container (mounted from ``/work``).
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Language:
    id: int
    name: str
    image: str
    filename: str
    # Command run in a first container to produce the executable. ``None`` for
    # interpreted languages. Writes into /work so the run container can see it.
    compile_cmd: str | None
    # Command executed in the run container (already wrapped in `timeout`).
    run_cmd: str


# The language ids are Judge0's stable ids, which the API, the web editor and
# the Informatics importer all use verbatim.
LANGUAGES: dict[int, Language] = {
    71: Language(71, "Python (3.11)", "python:3.11-slim", "main.py",
                 None, "python3 /work/main.py"),
    54: Language(54, "C++ (GCC 12)", "gcc:12", "main.cpp",
                 "g++ -O2 -std=c++17 -o /work/prog /work/main.cpp", "/work/prog"),
    50: Language(50, "C (GCC 12)", "gcc:12", "main.c",
                 "gcc -O2 -std=c17 -o /work/prog /work/main.c", "/work/prog"),
    62: Language(62, "Java (OpenJDK 17)", "eclipse-temurin:17-jdk", "Main.java",
                 "javac /work/Main.java", "java -cp /work Main"),
    63: Language(63, "JavaScript (Node.js 20)", "node:20-slim", "main.js",
                 None, "node /work/main.js"),
    46: Language(46, "Bash (5)", "bash:5", "main.sh",
                 None, "bash /work/main.sh"),
}


def get_language(language_id: int) -> Language | None:
    return LANGUAGES.get(language_id)


# Judge0 status ids. Only the ones a runner can actually produce are used; the
# full list is served on /statuses for API compatibility.
STATUSES: dict[int, str] = {
    1: "In Queue",
    2: "Processing",
    3: "Accepted",
    4: "Wrong Answer",
    5: "Time Limit Exceeded",
    6: "Compilation Error",
    7: "Runtime Error (SIGSEGV)",
    8: "Runtime Error (SIGXFSZ)",
    9: "Runtime Error (SIGFPE)",
    10: "Runtime Error (SIGABRT)",
    11: "Runtime Error (NZEC)",
    12: "Runtime Error (Other)",
    13: "Internal Error",
    14: "Exec Format Error",
}
