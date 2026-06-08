import argparse
import datetime as dt
import re
from pathlib import Path


TABLE_ROW_RE = re.compile(r"^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(.*?)\|.*$")
CONT_ROW_RE = re.compile(r"^\|\s*\|\s*(.*?)\|.*$")


def normalize(s: str) -> str:
    return s.strip().rstrip(',')


def parse_markdown_for_date(
    md_text: str,
    target_date: str,
    include_continuations: bool = False,
) -> list[tuple[str, list[str]]]:
    """
    Returns list of (exercise_name, sets_list) for rows matching target_date.
    Supports continuation lines immediately following a dated row inside the same table.
    """
    results: list[tuple[str, list[str]]] = []
    current_exercise: str | None = None
    collecting_for_row = False
    buffer_parts: list[str] = []

    lines = md_text.splitlines()
    for i, line in enumerate(lines):
        # Exercise header like `### Приседания ...`
        if line.startswith("### "):
            current_exercise = line.replace("### ", "").strip()
            collecting_for_row = False
            buffer_parts = []
            continue

        m = TABLE_ROW_RE.match(line)
        if m:
            date_str, sets = m.group(1), m.group(2)
            if date_str == target_date and current_exercise:
                if include_continuations:
                    collecting_for_row = True
                    buffer_parts = [normalize(sets)] if sets.strip() else []
                else:
                    # Immediately record only the dated row contents
                    single_parts = [normalize(sets)] if sets.strip() else []
                    if single_parts:
                        results.append((current_exercise, single_parts))
                    collecting_for_row = False
                    buffer_parts = []
                continue
            else:
                # encountered a different dated row; flush any previous collection
                if collecting_for_row and current_exercise and buffer_parts:
                    results.append((current_exercise, buffer_parts.copy()))
                collecting_for_row = False
                buffer_parts = []
                continue

        # Continuation row inside the same table block
        if collecting_for_row:
            m2 = CONT_ROW_RE.match(line)
            if m2:
                more_sets = normalize(m2.group(1))
                if more_sets:
                    buffer_parts.append(more_sets)
                continue
            else:
                # left the table; finalize the collected entry
                if current_exercise and buffer_parts:
                    results.append((current_exercise, buffer_parts.copy()))
                collecting_for_row = False
                buffer_parts = []

    # flush at EOF
    if collecting_for_row and current_exercise and buffer_parts:
        results.append((current_exercise, buffer_parts.copy()))

    return results


def format_exercise_line(name: str, parts: list[str]) -> str:
    # Join continuation parts with spaces, keeping commas within parts.
    joined = " ".join(parts)
    return f"{name}: {joined}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract today's workout plan from markdown tables")
    parser.add_argument(
        "file",
        nargs="?",
        type=Path,
        default=None,
        help="Path to markdown file with workout tables (default: 'План тренировок в качалке.md' near this script)",
    )
    parser.add_argument("--date", dest="date", help="Target date YYYY-MM-DD (default: today)")
    parser.add_argument(
        "--include-cont",
        action="store_true",
        help="Include continuation rows below the target date row",
    )
    args = parser.parse_args()

    if args.date:
        target_date = args.date
    else:
        target_date = dt.date.today().strftime("%Y-%m-%d")

    # Resolve markdown file path: use provided or default to sibling markdown file
    if args.file is not None:
        md_path = args.file
    else:
        md_path = Path(__file__).with_name("План тренировок в качалке.md")

    text = md_path.read_text(encoding="utf-8")
    items = parse_markdown_for_date(text, target_date, include_continuations=args.include_cont)

    if not items:
        print("Нет записей на выбранную дату.")
        return

    # Print in requested multi-line format
    for idx, (name, parts) in enumerate(items):
        line = format_exercise_line(name, parts)
        print(line)
        if idx != len(items) - 1:
            print()


if __name__ == "__main__":
    main()


