"""Language mapping between the LMS/Judge0 ids and Informatics lang ids.

Only the four mappings confirmed by the existing integration are enabled.
Node.js/Bash are intentionally absent: Informatics may or may not accept them
for a given problem, and guessing an id would send a solution to the wrong
compiler. The ``/problems/{id}`` endpoint exposes the real list, and the UI
shows the intersection.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class InformaticsLanguage:
    our_id: int
    informatics_id: int
    label: str
    extension: str
    family: str


LANGUAGES: dict[int, InformaticsLanguage] = {
    71: InformaticsLanguage(71, 27, "Python 3", "py", "python"),
    54: InformaticsLanguage(54, 3, "C++", "cpp", "cpp"),
    50: InformaticsLanguage(50, 2, "C", "c", "c"),
    62: InformaticsLanguage(62, 18, "Java", "java", "java"),
}


def get_language(our_id: int) -> InformaticsLanguage | None:
    return LANGUAGES.get(int(our_id))


def informatics_lang_id(our_id: int) -> int | None:
    language = get_language(our_id)
    return language.informatics_id if language else None


def extension_for(our_id: int) -> str | None:
    language = get_language(our_id)
    return language.extension if language else None


def supported_our_ids(problem_languages: list[dict] | None) -> list[int]:
    """Intersect the problem's Informatics language list with our presets."""
    if not problem_languages:
        return []
    allowed = set()
    for item in problem_languages:
        try:
            allowed.add(int(item.get("id")))
        except (TypeError, ValueError):
            continue
    return [our_id for our_id, lang in LANGUAGES.items() if lang.informatics_id in allowed]


def is_supported_by_problem(our_id: int, problem_languages: list[dict] | None) -> bool:
    return int(our_id) in supported_our_ids(problem_languages)
