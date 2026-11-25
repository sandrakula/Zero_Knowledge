"""Starter content for the three practice courses.

The bundles are plain Python dicts so the content is easy to review and does
not need a second parser. Every chapter/activity/task has a stable ``key``;
the seeder uses it for idempotency.
"""

from __future__ import annotations

from typing import Iterable


def _text(value: str) -> dict:
    return {"type": "text", "text": value}


def _paragraph(value: str) -> dict:
    return {"type": "paragraph", "content": [_text(value)]}


def _heading(value: str, level: int = 2) -> dict:
    return {"type": "heading", "attrs": {"level": level}, "content": [_text(value)]}


def _bullets(items: Iterable[str]) -> dict:
    return {
        "type": "bulletList",
        "content": [
            {"type": "listItem", "content": [_paragraph(item)]} for item in items
        ],
    }


def _theory(*blocks: dict) -> dict:
    return {"type": "doc", "content": list(blocks)}


def _theory_activity(key: str, name: str, blocks: list[dict]) -> dict:
    return {
        "key": key,
        "name": name,
        "activity_type": "TYPE_DYNAMIC",
        "activity_sub_type": "SUBTYPE_DYNAMIC_PAGE",
        "content": _theory(*blocks),
        "details": {"description": name},
    }


def _number_task(
    key: str,
    title: str,
    prompt: str,
    correct: float,
    *,
    topic: str,
    level: int,
    tolerance: float = 0,
    hint: str = "",
    minutes: int = 8,
) -> dict:
    return {
        "key": key,
        "title": title,
        "description": prompt,
        "hint": hint,
        "assignment_type": "NUMBER_ANSWER",
        "contents": {
            "_meta": {
                "key": key,
                "topic_key": topic,
                "level": level,
                "estimated_minutes": minutes,
                "source": "seed",
            },
            "prompt": prompt,
            "correct_value": correct,
            "tolerance": tolerance,
        },
    }


def _quiz_task(
    key: str,
    title: str,
    question: str,
    options: list[str],
    correct: list[int],
    *,
    topic: str,
    level: int,
    hint: str = "",
    minutes: int = 6,
) -> dict:
    response_type = "single" if len(correct) == 1 else "multiple"
    return {
        "key": key,
        "title": title,
        "description": question,
        "hint": hint,
        "assignment_type": "QUIZ",
        "contents": {
            "_meta": {
                "key": key,
                "topic_key": topic,
                "level": level,
                "estimated_minutes": minutes,
                "source": "seed",
            },
            "questions": [
                {
                    "questionUUID": f"question_{key}",
                    "questionText": question,
                    "response_type": response_type,
                    "options": [
                        {
                            "optionUUID": f"option_{key}_{index}",
                            "text": text,
                            "fileID": "",
                            "type": "text",
                            "assigned_right_answer": index in correct,
                        }
                        for index, text in enumerate(options)
                    ],
                }
            ],
            "grading_mode": "all_or_nothing",
        },
    }


def _code_task(
    key: str,
    title: str,
    description: str,
    cases: list[tuple[str, str]],
    *,
    topic: str,
    level: int,
    hint: str = "",
    minutes: int = 12,
    starter: str = "# ваше решение\n",
) -> dict:
    return {
        "key": key,
        "title": title,
        "description": description,
        "hint": hint,
        "assignment_type": "CODE",
        "contents": {
            "_meta": {
                "key": key,
                "topic_key": topic,
                "level": level,
                "estimated_minutes": minutes,
                "source": "seed",
            },
            "language_id": 71,
            "starter_code": starter,
            "test_cases": [
                {
                    "id": f"tc_{key}_{index}",
                    "label": f"Тест {index + 1}",
                    "stdin": stdin,
                    "expectedStdout": expected,
                    "hidden": index > 0,
                    "weight": 1,
                }
                for index, (stdin, expected) in enumerate(cases)
            ],
            "grading_mode": "equal_weight",
            "allow_student_run": True,
            "require_passing_to_submit": True,
            "show_test_details_on_fail": True,
            "show_solution_after_submit": False,
            "time_limit_ms": 2000,
            "memory_limit_kb": 65536,
        },
    }


def _practice_activity(key: str, title: str, tasks: list[dict]) -> dict:
    return {
        "key": key,
        "name": title,
        "activity_type": "TYPE_ASSIGNMENT",
        "activity_sub_type": "SUBTYPE_ASSIGNMENT_ANY",
        "assignment": {
            "title": title,
            "description": "Решите задачи. Проверка автоматическая.",
            "grading_type": "PERCENTAGE",
            "auto_grading": True,
            "tasks": tasks,
        },
    }


def _chapter(
    key: str,
    name: str,
    description: str,
    *,
    section: str,
    module: str,
    level: int,
    prerequisites: list[str],
    minutes: int,
    order: int,
    theory: list[dict],
    tasks: list[dict],
) -> dict:
    return {
        "key": key,
        "name": name,
        "description": description,
        "curriculum": {
            "section": section,
            "module": module,
            "level": level,
            "prerequisites": prerequisites,
            "estimated_minutes": minutes,
            "order": order,
        },
        "activities": [
            _theory_activity(f"{key}-theory", f"{name}: короткая теория", theory),
            _practice_activity(f"{key}-practice", f"{name}: практика", tasks),
        ],
    }


def python_bundle() -> dict:
    chapters = [
        _chapter(
            "py-io",
            "Ввод-вывод и арифметика",
            "Первые программы: читаем числа, считаем, выводим результат.",
            section="Основы языка",
            module="Старт",
            level=1,
            prerequisites=[],
            minutes=25,
            order=1,
            theory=[
                _heading("Как читать ввод"),
                _paragraph(
                    "В задачах числа приходят из стандартного ввода. В Python удобно "
                    "читать строку и разрезать её: a, b = map(int, input().split())."
                ),
                _paragraph(
                    "Результат печатают через print. Пробелы и перевод строки важны: "
                    "судья сравнивает вывод посимвольно, поэтому лишних подсказок быть не должно."
                ),
                _bullets(
                    [
                        "input() читает одну строку.",
                        "split() делит строку по пробелам.",
                        "map(int, ...) превращает части в числа.",
                    ]
                ),
            ],
            tasks=[
                _code_task(
                    "py-io-sum",
                    "Сумма двух чисел",
                    "Считайте два целых числа из одной строки и выведите их сумму.",
                    [("2 3\n", "5\n"), ("-5 10\n", "5\n"), ("0 0\n", "0\n")],
                    topic="py-io",
                    level=1,
                    starter="a, b = map(int, input().split())\n# выведите сумму\n",
                ),
                _code_task(
                    "py-io-rect",
                    "Площадь прямоугольника",
                    "Считайте ширину и высоту прямоугольника и выведите его площадь.",
                    [("3 4\n", "12\n"), ("10 10\n", "100\n")],
                    topic="py-io",
                    level=1,
                    starter="width, height = map(int, input().split())\n# выведите площадь\n",
                ),
                _code_task(
                    "py-io-minutes",
                    "Часы и минуты",
                    "Считайте число минут и выведите количество полных часов и оставшихся минут через пробел.",
                    [("135\n", "2 15\n"), ("59\n", "0 59\n"), ("60\n", "1 0\n")],
                    topic="py-io",
                    level=2,
                    starter="total = int(input())\n# выведите часы и минуты\n",
                ),
            ],
        ),
        _chapter(
            "py-conditions",
            "Условия",
            "Ветвления, сравнения и логические выражения.",
            section="Основы языка",
            module="Старт",
            level=1,
            prerequisites=["py-io"],
            minutes=25,
            order=2,
            theory=[
                _heading("if, elif, else"),
                _paragraph(
                    "Условие проверяется сверху вниз. Как только одно истинно, остальные "
                    "ветки пропускаются. Для двух вариантов хватает if/else."
                ),
                _paragraph(
                    "Сравнения можно объединять: and, or, not. Скобки помогают не "
                    "запутаться в приоритетах."
                ),
            ],
            tasks=[
                _code_task(
                    "py-cond-max",
                    "Максимум из двух",
                    "Считайте два целых числа и выведите большее.",
                    [("3 7\n", "7\n"), ("-1 -5\n", "-1\n"), ("4 4\n", "4\n")],
                    topic="py-conditions",
                    level=1,
                    starter="a, b = map(int, input().split())\n# выведите большее число\n",
                ),
                _code_task(
                    "py-cond-even",
                    "Чётное или нечётное",
                    "Считайте целое число. Выведите even, если оно чётное, иначе odd.",
                    [("4\n", "even\n"), ("7\n", "odd\n"), ("0\n", "even\n")],
                    topic="py-conditions",
                    level=1,
                    starter="n = int(input())\n# выведите even или odd\n",
                ),
                _code_task(
                    "py-cond-leap",
                    "Високосный год",
                    "Год високосный, если делится на 4, но не на 100, либо делится на 400. Выведите yes или no.",
                    [("2024\n", "yes\n"), ("1900\n", "no\n"), ("2000\n", "yes\n")],
                    topic="py-conditions",
                    level=2,
                    starter="year = int(input())\n# выведите yes или no\n",
                ),
            ],
        ),
        _chapter(
            "py-loops",
            "Циклы",
            "for, while и накопление результата.",
            section="Основы языка",
            module="Управление",
            level=1,
            prerequisites=["py-conditions"],
            minutes=30,
            order=3,
            theory=[
                _heading("Повторение"),
                _paragraph(
                    "for перебирает готовую последовательность, while повторяет, пока "
                    "условие истинно. Для счётчика удобно range(1, n + 1)."
                ),
                _paragraph(
                    "Накопление — самый частый приём: заведите переменную до цикла и "
                    "обновляйте её внутри."
                ),
            ],
            tasks=[
                _code_task(
                    "py-loops-sum",
                    "Сумма от 1 до n",
                    "Считайте n и выведите сумму чисел от 1 до n включительно.",
                    [("5\n", "15\n"), ("1\n", "1\n"), ("100\n", "5050\n")],
                    topic="py-loops",
                    level=1,
                    starter="n = int(input())\ntotal = 0\n# сложите числа\n",
                ),
                _code_task(
                    "py-loops-factorial",
                    "Факториал",
                    "Считайте n и выведите n! (факториал). Факториал 0 равен 1.",
                    [("5\n", "120\n"), ("0\n", "1\n"), ("7\n", "5040\n")],
                    topic="py-loops",
                    level=2,
                    starter="n = int(input())\nresult = 1\n# посчитайте факториал\n",
                ),
                _code_task(
                    "py-loops-digits",
                    "Количество цифр",
                    "Считайте целое число и выведите количество его цифр. Для 0 ответ 1.",
                    [("12345\n", "5\n"), ("0\n", "1\n"), ("-987\n", "3\n")],
                    topic="py-loops",
                    level=2,
                    starter="n = int(input())\n# посчитайте цифры\n",
                ),
            ],
        ),
        _chapter(
            "py-strings",
            "Строки и списки",
            "Индексы, срезы и обход последовательностей.",
            section="Данные",
            module="Коллекции",
            level=2,
            prerequisites=["py-loops"],
            minutes=30,
            order=4,
            theory=[
                _heading("Последовательности"),
                _paragraph(
                    "Строка и список — последовательности. Срез s[::-1] переворачивает "
                    "строку, len даёт длину, for перебирает элементы."
                ),
                _paragraph(
                    "Для максимума в списке удобно max, но на собеседовании часто просят "
                    "ручной проход. Оба варианта допустимы."
                ),
            ],
            tasks=[
                _code_task(
                    "py-str-reverse",
                    "Разворот строки",
                    "Считайте строку и выведите её в обратном порядке.",
                    [("abc\n", "cba\n"), ("hello\n", "olleh\n"), ("a\n", "a\n")],
                    topic="py-strings",
                    level=1,
                    starter="s = input()\n# выведите строку наоборот\n",
                ),
                _code_task(
                    "py-str-vowels",
                    "Гласные",
                    "Считайте строку и выведите количество гласных. Гласные: a, e, i, o, u, y. Регистр не важен.",
                    [("hello\n", "2\n"), ("Python\n", "2\n"), ("rhythm\n", "1\n")],
                    topic="py-strings",
                    level=2,
                    starter="s = input().lower()\n# посчитайте гласные\n",
                ),
                _code_task(
                    "py-str-maxlist",
                    "Максимум в списке",
                    "В первой строке n, во второй — n целых чисел. Выведите максимум.",
                    [
                        ("5\n3 9 1 7 4\n", "9\n"),
                        ("3\n-5 -2 -9\n", "-2\n"),
                        ("1\n42\n", "42\n"),
                    ],
                    topic="py-strings",
                    level=2,
                    starter="n = int(input())\nnumbers = list(map(int, input().split()))\n",
                ),
            ],
        ),
        _chapter(
            "py-collections",
            "Словари и множества",
            "Частоты, уникальность и пересечения.",
            section="Данные",
            module="Коллекции",
            level=2,
            prerequisites=["py-strings"],
            minutes=30,
            order=5,
            theory=[
                _heading("Словарь и множество"),
                _paragraph(
                    "Словарь хранит пары ключ-значение и отвечает на вопрос «сколько раз "
                    "встретилось». Множество хранит только уникальные элементы."
                ),
                _paragraph(
                    "Для подсчёта частот удобно d[word] = d.get(word, 0) + 1 или "
                    "collections.Counter."
                ),
            ],
            tasks=[
                _code_task(
                    "py-coll-unique",
                    "Уникальные слова",
                    "В первой строке n, во второй — n слов. Выведите количество уникальных слов.",
                    [
                        ("5\na b a c b\n", "3\n"),
                        ("3\nx x x\n", "1\n"),
                    ],
                    topic="py-collections",
                    level=1,
                    starter="n = int(input())\nwords = input().split()\n",
                ),
                _code_task(
                    "py-coll-top",
                    "Самое частое слово",
                    "В первой строке n, во второй — n слов. Выведите слово, которое встречается чаще всего. Гарантируется, что самое частое слово одно.",
                    [
                        ("5\na b a c a\n", "a\n"),
                        ("4\nx y y z\n", "y\n"),
                    ],
                    topic="py-collections",
                    level=2,
                    starter="n = int(input())\nwords = input().split()\n",
                ),
                _code_task(
                    "py-coll-intersection",
                    "Пересечение",
                    "Даны две строки с целыми числами. Выведите общие числа по возрастанию.",
                    [
                        ("1 2 3\n2 3 4\n", "2 3\n"),
                        ("1 1 2\n1 3\n", "1\n"),
                        ("1 2\n3 4\n", "\n"),
                    ],
                    topic="py-collections",
                    level=3,
                    starter="a = set(map(int, input().split()))\nb = set(map(int, input().split()))\n",
                ),
            ],
        ),
        _chapter(
            "py-functions",
            "Функции и рекурсия",
            "Параметры, возврат значения и повторное использование кода.",
            section="Функции",
            module="Абстракция",
            level=2,
            prerequisites=["py-loops"],
            minutes=30,
            order=6,
            theory=[
                _heading("Функция как единица кода"),
                _paragraph(
                    "Функция принимает аргументы и возвращает результат через return. "
                    "Если return нет, функция возвращает None."
                ),
                _paragraph(
                    "Рекурсия — вызов функцией себя с более простым аргументом. Обязательно "
                    "нужен базовый случай, иначе будет переполнение стека."
                ),
            ],
            tasks=[
                _code_task(
                    "py-fn-gcd",
                    "НОД",
                    "Считайте два целых числа и выведите их наибольший общий делитель.",
                    [("12 18\n", "6\n"), ("7 13\n", "1\n"), ("0 5\n", "5\n")],
                    topic="py-functions",
                    level=2,
                    starter="a, b = map(int, input().split())\n",
                ),
                _code_task(
                    "py-fn-fib",
                    "Числа Фибоначчи",
                    "Считайте n и выведите n-е число Фибоначчи. fib(0)=0, fib(1)=1.",
                    [("0\n", "0\n"), ("1\n", "1\n"), ("10\n", "55\n")],
                    topic="py-functions",
                    level=2,
                    starter="n = int(input())\n",
                ),
                _code_task(
                    "py-fn-power",
                    "Степень",
                    "Считайте a и b, выведите a в степени b.",
                    [("2 10\n", "1024\n"), ("5 0\n", "1\n"), ("3 4\n", "81\n")],
                    topic="py-functions",
                    level=1,
                    starter="a, b = map(int, input().split())\n",
                ),
            ],
        ),
        _chapter(
            "py-files",
            "Файлы, потоки и исключения",
            "Чтение потока, обработка ошибок и устойчивые программы.",
            section="Практика",
            module="Потоки и ошибки",
            level=2,
            prerequisites=["py-functions"],
            minutes=25,
            order=7,
            theory=[
                _heading("Поток вместо файла"),
                _paragraph(
                    "В задачах файл часто заменяет стандартный ввод. sys.stdin.read() "
                    "читает всё сразу, splitlines() делит на строки."
                ),
                _paragraph(
                    "Если данные могут быть некорректными, используйте try/except: "
                    "программа должна пропустить плохую строку, а не упасть."
                ),
            ],
            tasks=[
                _code_task(
                    "py-files-lines",
                    "Количество строк",
                    "Считайте весь ввод и выведите количество строк.",
                    [("a\nb\nc\n", "3\n"), ("one\n", "1\n"), ("", "0\n")],
                    topic="py-files",
                    level=1,
                    starter="import sys\ntext = sys.stdin.read()\n",
                ),
                _code_task(
                    "py-files-sum",
                    "Сумма чисел из потока",
                    "Считайте все целые числа из ввода и выведите их сумму.",
                    [("1 2 3\n", "6\n"), ("10\n-5\n", "5\n"), ("", "0\n")],
                    topic="py-files",
                    level=2,
                    starter="import sys\nnumbers = sys.stdin.read().split()\n",
                ),
                _code_task(
                    "py-files-safe",
                    "Сумма только чисел",
                    "В каждой строке может быть число или мусор. Просуммируйте только корректные целые числа.",
                    [("1\nx\n3\n", "4\n"), ("abc\n", "0\n"), ("10\n-2\nzzz\n", "8\n")],
                    topic="py-files",
                    level=3,
                    starter="import sys\n",
                ),
            ],
        ),
        _chapter(
            "py-oop",
            "ООП: минимум",
            "Классы, объекты и наследование.",
            section="Функции",
            module="ООП",
            level=3,
            prerequisites=["py-functions"],
            minutes=20,
            order=8,
            theory=[
                _heading("Класс и объект"),
                _paragraph(
                    "Класс описывает данные и поведение, объект — конкретный экземпляр. "
                    "__init__ вызывается при создании объекта."
                ),
                _paragraph(
                    "self — ссылка на текущий объект. В методах он всегда первый параметр, "
                    "но при вызове его не передают."
                ),
            ],
            tasks=[
                _quiz_task(
                    "py-oop-init",
                    "Конструктор",
                    "Что делает метод __init__?",
                    [
                        "Инициализирует новый объект",
                        "Удаляет объект",
                        "Создаёт новый класс",
                        "Вызывает только родительский класс",
                    ],
                    [0],
                    topic="py-oop",
                    level=1,
                ),
                _quiz_task(
                    "py-oop-self",
                    "Что такое self?",
                    "Зачем нужен self в методах класса?",
                    [
                        "Это ссылка на текущий объект",
                        "Это имя модуля",
                        "Это глобальная переменная",
                        "Это тип возвращаемого значения",
                    ],
                    [0],
                    topic="py-oop",
                    level=2,
                ),
                _quiz_task(
                    "py-oop-inherit",
                    "Наследование",
                    "Что даёт запись class B(A)?",
                    [
                        "B получает методы и атрибуты A",
                        "A получает методы B",
                        "Классы объединяются в один",
                        "Создаётся копия класса A",
                    ],
                    [0],
                    topic="py-oop",
                    level=3,
                ),
            ],
        ),
        _chapter(
            "py-testing",
            "Тесты и отладка",
            "Как проверять код и читать падения.",
            section="Практика",
            module="Качество",
            level=3,
            prerequisites=["py-functions", "py-oop"],
            minutes=20,
            order=9,
            theory=[
                _heading("Зачем тесты"),
                _paragraph(
                    "Тест фиксирует ожидаемое поведение. Хороший тест падает, когда код "
                    "сломан, и проходит, когда всё в порядке."
                ),
                _paragraph(
                    "Начинайте с простого примера, затем добавляйте граничные случаи: "
                    "пустой ввод, ноль, отрицательные числа."
                ),
            ],
            tasks=[
                _quiz_task(
                    "py-test-assert",
                    "assert",
                    "Что делает assert condition?",
                    [
                        "Проверяет условие и падает, если оно ложно",
                        "Всегда завершает программу",
                        "Печатает условие",
                        "Игнорирует ошибки",
                    ],
                    [0],
                    topic="py-testing",
                    level=1,
                ),
                _quiz_task(
                    "py-test-unit",
                    "Юнит-тест",
                    "Что такое юнит-тест?",
                    [
                        "Проверка небольшой единицы кода",
                        "Тест всего приложения в браузере",
                        "Ручная проверка преподавателем",
                        "Замер скорости сети",
                    ],
                    [0],
                    topic="py-testing",
                    level=2,
                ),
                _quiz_task(
                    "py-test-fail",
                    "Упавший тест",
                    "Тест упал. Что делать первым делом?",
                    [
                        "Понять, какое поведение ожидалось и что получилось",
                        "Удалить тест",
                        "Отключить проверки",
                        "Переписать тест под текущий результат",
                    ],
                    [0],
                    topic="py-testing",
                    level=3,
                ),
            ],
        ),
    ]
    return {
        "version": 1,
        "course": {
            "seed_key": "python",
            "name": "Python-практикум",
            "description": (
                "Экспресс-курс Python для студентов: ввод-вывод, условия, циклы, "
                "коллекции, функции, ошибки, ООП и тесты. Задачи проверяются автотестами."
            ),
            "about": (
                "Девять модулей с короткой теорией и задачами трёх уровней. "
                "Подходит для первого курса и подготовки к практике."
            ),
            "learnings": (
                "Читать ввод и выводить результат, писать условия и циклы, "
                "работать со строками и коллекциями, писать функции и тесты."
            ),
            "tags": "python, программирование, практика",
            "public": True,
            "published": True,
        },
        "chapters": chapters,
    }


def sql_bundle() -> dict:
    chapters = [
        _chapter(
            "sql-select",
            "SELECT, WHERE, ORDER BY",
            "Как выбрать нужные строки и столбцы.",
            section="Запросы",
            module="Основы",
            level=1,
            prerequisites=[],
            minutes=20,
            order=1,
            theory=[
                _heading("Базовый запрос"),
                _paragraph(
                    "SELECT перечисляет столбцы, FROM задаёт таблицу, WHERE фильтрует "
                    "строки, ORDER BY сортирует результат."
                ),
                _paragraph(
                    "Порядок выполнения отличается от порядка записи: сначала FROM, "
                    "потом WHERE, затем SELECT и ORDER BY."
                ),
            ],
            tasks=[
                _quiz_task(
                    "sql-select-where",
                    "WHERE",
                    "Что вернёт SELECT * FROM students WHERE grade >= 4?",
                    [
                        "Все строки, где grade не меньше 4",
                        "Только столбец grade",
                        "Строки, где grade ровно 4",
                        "Ошибку синтаксиса",
                    ],
                    [0],
                    topic="sql-select",
                    level=1,
                ),
                _quiz_task(
                    "sql-select-having",
                    "WHERE и HAVING",
                    "Чем WHERE отличается от HAVING?",
                    [
                        "WHERE фильтрует строки до группировки, HAVING — группы после",
                        "Это одно и то же",
                        "HAVING работает только с числами",
                        "WHERE работает только после GROUP BY",
                    ],
                    [0],
                    topic="sql-select",
                    level=2,
                ),
            ],
        ),
        _chapter(
            "sql-aggregates",
            "Агрегаты и GROUP BY",
            "COUNT, SUM, AVG и группировка.",
            section="Запросы",
            module="Основы",
            level=1,
            prerequisites=["sql-select"],
            minutes=20,
            order=2,
            theory=[
                _heading("Группировка"),
                _paragraph(
                    "Агрегатные функции сворачивают много строк в одну. GROUP BY задаёт, "
                    "по каким столбцам строятся группы."
                ),
                _paragraph(
                    "COUNT(*) считает строки, COUNT(column) — непустые значения столбца."
                ),
            ],
            tasks=[
                _quiz_task(
                    "sql-agg-count",
                    "COUNT",
                    "Чем COUNT(*) отличается от COUNT(email)?",
                    [
                        "COUNT(email) не считает NULL в email",
                        "Ничем",
                        "COUNT(*) медленнее и не считается",
                        "COUNT(email) считает только уникальные",
                    ],
                    [0],
                    topic="sql-aggregates",
                    level=1,
                ),
                _quiz_task(
                    "sql-agg-group",
                    "GROUP BY",
                    "Что делает GROUP BY department?",
                    [
                        "Собирает строки в группы по department",
                        "Сортирует по department",
                        "Удаляет дубликаты",
                        "Создаёт индекс",
                    ],
                    [0],
                    topic="sql-aggregates",
                    level=2,
                ),
            ],
        ),
        _chapter(
            "sql-joins",
            "JOIN",
            "Как соединять таблицы.",
            section="Запросы",
            module="Связи",
            level=2,
            prerequisites=["sql-select"],
            minutes=25,
            order=3,
            theory=[
                _heading("Виды соединений"),
                _paragraph(
                    "INNER JOIN оставляет только совпавшие пары. LEFT JOIN сохраняет все "
                    "строки левой таблицы, а справа подставляет NULL, если пары нет."
                ),
                _paragraph(
                    "Условие соединения пишется в ON, а фильтр по результату — в WHERE."
                ),
            ],
            tasks=[
                _quiz_task(
                    "sql-join-inner",
                    "INNER JOIN",
                    "Что попадёт в результат INNER JOIN двух таблиц?",
                    [
                        "Только строки, у которых есть пара в обеих таблицах",
                        "Все строки левой таблицы",
                        "Все строки обеих таблиц",
                        "Только строки без пары",
                    ],
                    [0],
                    topic="sql-joins",
                    level=1,
                ),
                _quiz_task(
                    "sql-join-left",
                    "LEFT JOIN",
                    "Зачем нужен LEFT JOIN?",
                    [
                        "Сохранить все строки левой таблицы, даже без пары",
                        "Оставить только совпадения",
                        "Удалить дубликаты",
                        "Соединить больше двух таблиц",
                    ],
                    [0],
                    topic="sql-joins",
                    level=2,
                ),
            ],
        ),
        _chapter(
            "sql-subqueries",
            "Подзапросы и CTE",
            "Запрос внутри запроса и WITH.",
            section="Запросы",
            module="Связи",
            level=2,
            prerequisites=["sql-aggregates", "sql-joins"],
            minutes=25,
            order=4,
            theory=[
                _heading("Подзапрос"),
                _paragraph(
                    "Подзапрос возвращает значение или таблицу, которую использует внешний "
                    "запрос. Скалярный подзапрос возвращает одну строку и один столбец."
                ),
                _paragraph(
                    "CTE (WITH name AS (...)) делает сложный запрос читаемее и позволяет "
                    "ссылаться на промежуточный результат."
                ),
            ],
            tasks=[
                _quiz_task(
                    "sql-sub-scalar",
                    "Скалярный подзапрос",
                    "Что возвращает скалярный подзапрос?",
                    [
                        "Одно значение: одну строку и один столбец",
                        "Всегда всю таблицу",
                        "Несколько столбцов",
                        "Только NULL",
                    ],
                    [0],
                    topic="sql-subqueries",
                    level=2,
                ),
                _quiz_task(
                    "sql-sub-cte",
                    "CTE",
                    "Зачем использовать WITH?",
                    [
                        "Чтобы вынести промежуточный результат и упростить запрос",
                        "Чтобы ускорить любой запрос",
                        "Чтобы создать таблицу навсегда",
                        "Чтобы удалить данные",
                    ],
                    [0],
                    topic="sql-subqueries",
                    level=2,
                ),
            ],
        ),
        _chapter(
            "sql-windows",
            "Оконные функции",
            "ROW_NUMBER, RANK и PARTITION BY.",
            section="Запросы",
            module="Продвинутое",
            level=3,
            prerequisites=["sql-aggregates"],
            minutes=25,
            order=5,
            theory=[
                _heading("Окно"),
                _paragraph(
                    "Оконная функция считает по набору строк, но не сворачивает результат "
                    "в одну строку. OVER задаёт окно."
                ),
                _paragraph(
                    "PARTITION BY делит строки на независимые группы, ORDER BY внутри окна "
                    "задаёт порядок для нумерации и ранжирования."
                ),
            ],
            tasks=[
                _quiz_task(
                    "sql-win-number",
                    "ROW_NUMBER и RANK",
                    "Чем RANK отличается от ROW_NUMBER?",
                    [
                        "RANK даёт одинаковый номер при равенстве, ROW_NUMBER — всегда разный",
                        "Ничем",
                        "ROW_NUMBER работает только с датами",
                        "RANK нельзя использовать с ORDER BY",
                    ],
                    [0],
                    topic="sql-windows",
                    level=3,
                ),
                _quiz_task(
                    "sql-win-partition",
                    "PARTITION BY",
                    "Что делает PARTITION BY department в OVER(...)?",
                    [
                        "Считает окно отдельно для каждого department",
                        "Сортирует по department",
                        "Фильтрует строки",
                        "Группирует результат в одну строку",
                    ],
                    [0],
                    topic="sql-windows",
                    level=3,
                ),
            ],
        ),
        _chapter(
            "sql-indexes",
            "Индексы и планы",
            "Почему запросы бывают медленными.",
            section="Производительность",
            module="Оптимизация",
            level=3,
            prerequisites=["sql-joins"],
            minutes=20,
            order=6,
            theory=[
                _heading("Индекс"),
                _paragraph(
                    "Индекс — структура, которая ускоряет поиск по столбцу. B-tree хорошо "
                    "работает для равенства и диапазонов."
                ),
                _paragraph(
                    "Индекс ускоряет чтение, но замедляет вставку и занимает место. "
                    "Индексировать всё подряд — плохая идея."
                ),
            ],
            tasks=[
                _quiz_task(
                    "sql-idx-btree",
                    "B-tree",
                    "Для каких условий B-tree индекс полезнее всего?",
                    [
                        "Равенство и диапазоны",
                        "Только LIKE '%текст%'",
                        "Только NULL",
                        "Только сортировка без фильтра",
                    ],
                    [0],
                    topic="sql-indexes",
                    level=2,
                ),
                _quiz_task(
                    "sql-idx-cost",
                    "Цена индекса",
                    "Почему не стоит индексировать каждый столбец?",
                    [
                        "Замедляются вставки и обновления, растёт размер",
                        "Индексы всегда бесплатны",
                        "PostgreSQL не поддерживает много индексов",
                        "Индексы ломают SELECT",
                    ],
                    [0],
                    topic="sql-indexes",
                    level=3,
                ),
            ],
        ),
        _chapter(
            "sql-transactions",
            "Транзакции и целостность",
            "ACID и откат изменений.",
            section="Надёжность",
            module="Данные",
            level=3,
            prerequisites=["sql-joins"],
            minutes=20,
            order=7,
            theory=[
                _heading("Транзакция"),
                _paragraph(
                    "Транзакция объединяет несколько операций в одну единицу работы. "
                    "COMMIT фиксирует результат, ROLLBACK отменяет всё с начала транзакции."
                ),
                _paragraph(
                    "ACID — атомарность, согласованность, изолированность и долговечность."
                ),
            ],
            tasks=[
                _quiz_task(
                    "sql-tx-acid",
                    "ACID",
                    "Что означает атомарность транзакции?",
                    [
                        "Либо выполняются все операции, либо ни одна",
                        "Транзакция всегда быстрая",
                        "Данные не сжимаются",
                        "Запрос выполняется параллельно",
                    ],
                    [0],
                    topic="sql-transactions",
                    level=2,
                ),
                _quiz_task(
                    "sql-tx-rollback",
                    "ROLLBACK",
                    "Что делает ROLLBACK?",
                    [
                        "Отменяет изменения текущей транзакции",
                        "Сохраняет изменения",
                        "Удаляет таблицу",
                        "Создаёт точку восстановления навсегда",
                    ],
                    [0],
                    topic="sql-transactions",
                    level=2,
                ),
            ],
        ),
    ]
    return {
        "version": 1,
        "course": {
            "seed_key": "sql",
            "name": "SQL-практикум",
            "description": (
                "Экспресс-курс SQL для студентов: SELECT, агрегаты, JOIN, подзапросы, "
                "оконные функции, индексы и транзакции."
            ),
            "about": (
                "Семь модулей с короткой теорией и проверочными вопросами. "
                "Практика запросов на реальном PostgreSQL добавляется отдельным этапом."
            ),
            "learnings": (
                "Писать SELECT и фильтры, группировать данные, соединять таблицы, "
                "использовать подзапросы и оконные функции, понимать индексы и транзакции."
            ),
            "tags": "sql, базы данных, практика",
            "public": True,
            "published": True,
        },
        "chapters": chapters,
    }


def math_bundle() -> dict:
    chapters = [
        _chapter(
            "math-logic",
            "Логика и доказательства",
            "Высказывания, импликация и таблицы истинности.",
            section="Фундамент",
            module="Логика",
            level=1,
            prerequisites=[],
            minutes=20,
            order=1,
            theory=[
                _heading("Импликация"),
                _paragraph(
                    "A → B ложно только в одном случае: A истинно, B ложно. "
                    "Во всех остальных случаях импликация истинна."
                ),
                _paragraph(
                    "Таблица истинности для n переменных содержит 2^n строк."
                ),
            ],
            tasks=[
                _number_task(
                    "math-logic-rows",
                    "Строки таблицы истинности",
                    "Сколько строк в таблице истинности для трёх переменных?",
                    8,
                    topic="math-logic",
                    level=1,
                ),
                _quiz_task(
                    "math-logic-impl",
                    "Когда импликация ложна?",
                    "Выберите случай, когда A → B ложно.",
                    [
                        "A истинно, B ложно",
                        "A ложно, B истинно",
                        "A и B истинны",
                        "A и B ложны",
                    ],
                    [0],
                    topic="math-logic",
                    level=2,
                ),
            ],
        ),
        _chapter(
            "math-sets",
            "Множества и функции",
            "Объединение, пересечение и мощность.",
            section="Фундамент",
            module="Множества",
            level=1,
            prerequisites=["math-logic"],
            minutes=20,
            order=2,
            theory=[
                _heading("Мощность объединения"),
                _paragraph(
                    "|A ∪ B| = |A| + |B| − |A ∩ B|. Пересечение вычитается, потому что "
                    "его элементы посчитаны дважды."
                ),
            ],
            tasks=[
                _number_task(
                    "math-sets-union",
                    "Мощность объединения",
                    "|A| = 5, |B| = 7, |A ∩ B| = 3. Найдите |A ∪ B|.",
                    9,
                    topic="math-sets",
                    level=1,
                ),
                _quiz_task(
                    "math-sets-subset",
                    "Подмножество",
                    "Что значит A ⊆ B?",
                    [
                        "Каждый элемент A принадлежит B",
                        "A и B совпадают",
                        "B содержит больше элементов, чем A",
                        "A пусто",
                    ],
                    [0],
                    topic="math-sets",
                    level=2,
                ),
            ],
        ),
        _chapter(
            "math-combinatorics",
            "Комбинаторика",
            "Перестановки и сочетания.",
            section="Дискретное",
            module="Подсчёт",
            level=2,
            prerequisites=["math-sets"],
            minutes=25,
            order=3,
            theory=[
                _heading("Порядок важен?"),
                _paragraph(
                    "Перестановки учитывают порядок, сочетания — нет. "
                    "C(n, k) = n! / (k! (n − k)!)."
                ),
            ],
            tasks=[
                _number_task(
                    "math-comb-c",
                    "Сочетания",
                    "Чему равно C(10, 3)?",
                    120,
                    topic="math-combinatorics",
                    level=2,
                ),
                _number_task(
                    "math-comb-p",
                    "Перестановки",
                    "Сколькими способами можно расставить 5 разных книг в ряд?",
                    120,
                    topic="math-combinatorics",
                    level=2,
                ),
                _quiz_task(
                    "math-comb-order",
                    "Порядок",
                    "Когда используют сочетания, а не перестановки?",
                    [
                        "Когда порядок не важен",
                        "Когда порядок важен",
                        "Когда есть повторения",
                        "Когда элементов меньше двух",
                    ],
                    [0],
                    topic="math-combinatorics",
                    level=1,
                ),
            ],
        ),
        _chapter(
            "math-probability",
            "Вероятность",
            "События, независимость и простые оценки.",
            section="Дискретное",
            module="Вероятность",
            level=2,
            prerequisites=["math-combinatorics"],
            minutes=25,
            order=4,
            theory=[
                _heading("Вероятность"),
                _paragraph(
                    "Вероятность события — доля благоприятных исходов среди равновозможных. "
                    "Для независимых событий вероятности перемножаются."
                ),
            ],
            tasks=[
                _number_task(
                    "math-prob-even",
                    "Чётное на кубике",
                    "Какова вероятность выпадения чётного числа на честном шестигранном кубике?",
                    0.5,
                    topic="math-probability",
                    level=1,
                    tolerance=0.001,
                ),
                _number_task(
                    "math-prob-heads",
                    "Два орла",
                    "Какова вероятность двух орлов при двух бросках честной монеты?",
                    0.25,
                    topic="math-probability",
                    level=2,
                    tolerance=0.001,
                ),
                _quiz_task(
                    "math-prob-indep",
                    "Независимость",
                    "Что значит, что события A и B независимы?",
                    [
                        "P(A ∩ B) = P(A) · P(B)",
                        "Они не могут произойти одновременно",
                        "P(A) + P(B) = 1",
                        "Одно событие всегда влечёт другое",
                    ],
                    [0],
                    topic="math-probability",
                    level=2,
                ),
            ],
        ),
        _chapter(
            "math-linear",
            "Линейная алгебра",
            "Векторы, скалярное произведение и определитель.",
            section="Прикладное",
            module="Матрицы",
            level=2,
            prerequisites=["math-sets"],
            minutes=25,
            order=5,
            theory=[
                _heading("Скалярное произведение"),
                _paragraph(
                    "Для векторов a и b: a·b = Σ a_i b_i. Оно измеряет, насколько векторы "
                    "смотрят в одну сторону."
                ),
                _paragraph("Определитель 2×2: ad − bc для матрицы [[a, b], [c, d]]."),
            ],
            tasks=[
                _number_task(
                    "math-lin-dot",
                    "Скалярное произведение",
                    "Вычислите (1, 2, 3) · (4, 5, 6).",
                    32,
                    topic="math-linear",
                    level=1,
                ),
                _number_task(
                    "math-lin-det",
                    "Определитель",
                    "Вычислите определитель матрицы [[1, 2], [3, 4]].",
                    -2,
                    topic="math-linear",
                    level=2,
                ),
                _quiz_task(
                    "math-lin-mult",
                    "Размерность произведения",
                    "Матрица A имеет размер 2×3, матрица B — 3×4. Какой размер у AB?",
                    ["2×4", "3×3", "4×2", "Произведение не определено"],
                    [0],
                    topic="math-linear",
                    level=2,
                ),
            ],
        ),
        _chapter(
            "math-discrete",
            "Дискретная математика",
            "Графы, степени и пути.",
            section="Прикладное",
            module="Графы",
            level=3,
            prerequisites=["math-sets", "math-combinatorics"],
            minutes=25,
            order=6,
            theory=[
                _heading("Графы"),
                _paragraph(
                    "В полном графе K_n каждая пара вершин соединена ребром, поэтому "
                    "рёбер n(n − 1)/2."
                ),
                _paragraph(
                    "Сумма степеней всех вершин равна удвоенному числу рёбер."
                ),
            ],
            tasks=[
                _number_task(
                    "math-disc-k5",
                    "Рёбра K5",
                    "Сколько рёбер в полном графе на 5 вершинах?",
                    10,
                    topic="math-discrete",
                    level=2,
                ),
                _number_task(
                    "math-disc-degree",
                    "Сумма степеней",
                    "Чему равна сумма степеней вершин треугольника?",
                    6,
                    topic="math-discrete",
                    level=1,
                ),
                _quiz_task(
                    "math-disc-euler",
                    "Эйлеров путь",
                    "Когда в связном графе существует эйлеров путь?",
                    [
                        "Когда ровно 0 или 2 вершины имеют нечётную степень",
                        "Когда все степени чётные",
                        "Когда граф полный",
                        "Когда в графе нет циклов",
                    ],
                    [0],
                    topic="math-discrete",
                    level=3,
                ),
            ],
        ),
    ]
    return {
        "version": 1,
        "course": {
            "seed_key": "math",
            "name": "Математика и логика для CS",
            "description": (
                "Экспресс-курс математики для программистов: логика, множества, "
                "комбинаторика, вероятность, линейная алгебра и дискретная математика."
            ),
            "about": (
                "Шесть модулей с короткой теорией и проверяемыми задачами. "
                "Без программирования — только математика и логика."
            ),
            "learnings": (
                "Строить таблицы истинности, считать мощности и сочетания, оценивать "
                "вероятности, работать с векторами и матрицами, понимать основы графов."
            ),
            "tags": "математика, логика, алгоритмы",
            "public": True,
            "published": True,
        },
        "chapters": chapters,
    }


def build_practice_bundles() -> list[dict]:
    return [python_bundle(), sql_bundle(), math_bundle()]
