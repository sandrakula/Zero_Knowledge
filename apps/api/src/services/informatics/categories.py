"""Informatics topic categories (the 21 blocks from the Excel tracker)."""

from __future__ import annotations

import json

# Informatics course id -> (category code, readable name).
COURSE_TO_CATEGORY: dict[int, tuple[str, str]] = {
    34: ("CAT_001_INF_IO", "Ввод-вывод и арифметика"),
    7: ("CAT_002_INF_IF", "Условный оператор"),
    8: ("CAT_003_INF_LOOP", "Операторы цикла"),
    19: ("CAT_004_INF_DTYPES", "Типы данных"),
    20: ("CAT_005_INF_ARRAYS", "Массивы"),
    5: ("CAT_006_INF_RECURSION", "Функции и рекурсия"),
    95: ("CAT_007_INF_PYTHON", "Python"),
    83: ("CAT_008_INF_TESTS", "Составление тестов"),
    3: ("CAT_009_INF_SORT", "Поиск и сортировка"),
    18: ("CAT_010_INF_DSTRUCT", "Структуры данных"),
    6: ("CAT_011_INF_GRAPH", "Алгоритмы на графах"),
    17: ("CAT_012_INF_MATH", "Арифметика и числа"),
    9: ("CAT_013_INF_DP", "Динамическое программирование"),
    21: ("CAT_014_INF_COMB", "Комбинаторика"),
    29: ("CAT_015_INF_STRING", "Алгоритмы на строках"),
    22: ("CAT_016_INF_GEOM", "Геометрия"),
    1474: ("CAT_017_INF_GREED", "Жадные алгоритмы"),
    30: ("CAT_018_INF_GAME", "Игры и стратегии"),
    150: ("CAT_019_INF_REGEXP", "Регулярные выражения"),
    93: ("CAT_020_INF_OPT", "Глобальная оптимизация"),
    84: ("CAT_021_INF_FSM", "Разбор выражений и автоматы"),
}

CATEGORY_NAMES: dict[str, str] = {code: name for code, name in COURSE_TO_CATEGORY.values()}

# Ordered list of category codes, matching the course order in the curriculum.
CATEGORY_ORDER: list[str] = [code for code, _ in COURSE_TO_CATEGORY.values()]

# Authoritative task counts per category (from the «Хроники» spreadsheet,
# TASKS_CATEGORIES). The problem library is a superset, so totals come from here
# rather than from counting rows in `problem`.
CATEGORY_TOTALS: dict[str, int] = {
    "CAT_001_INF_IO": 22,
    "CAT_002_INF_IF": 31,
    "CAT_003_INF_LOOP": 62,
    "CAT_004_INF_DTYPES": 46,
    "CAT_005_INF_ARRAYS": 33,
    "CAT_006_INF_RECURSION": 42,
    "CAT_007_INF_PYTHON": 15,
    "CAT_008_INF_TESTS": 2,
    "CAT_009_INF_SORT": 48,
    "CAT_010_INF_DSTRUCT": 53,
    "CAT_011_INF_GRAPH": 91,
    "CAT_012_INF_MATH": 86,
    "CAT_013_INF_DP": 97,
    "CAT_014_INF_COMB": 27,
    "CAT_015_INF_STRING": 7,
    "CAT_016_INF_GEOM": 122,
    "CAT_017_INF_GREED": 8,
    "CAT_018_INF_GAME": 13,
    "CAT_019_INF_REGEXP": 17,
    "CAT_020_INF_OPT": 4,
    "CAT_021_INF_FSM": 7,
}


def load_problem_category_map(full_topics_path: str) -> dict[int, str]:
    """Build {informatics problem id: category code} from the scraped topics.

    ``full_topics_path`` points at ``full_topics.json`` produced by the scraper:
    {"<course_id>: <title>": {"problems": [problem ids]}}.
    """
    data = json.load(open(full_topics_path, encoding="utf-8"))
    mapping: dict[int, str] = {}
    for key, value in data.items():
        course_id = int(key.split(":", 1)[0].strip())
        category = COURSE_TO_CATEGORY.get(course_id)
        if not category:
            continue
        for problem_id in value.get("problems", []):
            mapping[int(problem_id)] = category[0]
    return mapping
