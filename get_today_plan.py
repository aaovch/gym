import argparse
import datetime as dt
from pathlib import Path

from workout_data import load_database, sessions_to_entries


def format_exercise_line(name: str, parts: list[str]) -> str:
    joined = " ".join(parts)
    return f"{name}: {joined}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract today's workout plan from JSON database")
    parser.add_argument(
        "file",
        nargs="?",
        type=Path,
        default=None,
        help="Path to JSON database (default: data/workouts.json)",
    )
    parser.add_argument("--date", dest="date", help="Target date YYYY-MM-DD (default: today)")
    args = parser.parse_args()

    target_date = args.date or dt.date.today().strftime("%Y-%m-%d")

    if args.file is not None:
        db_path = args.file
    else:
        db_path = Path(__file__).resolve().parent / "data" / "workouts.json"

    db = load_database(db_path)
    items = []
    for session in db["sessions"]:
        if session["date"] != target_date:
            continue
        entry = sessions_to_entries([session])[0]
        items.append((entry["exercise"], entry["parts"]))

    if not items:
        print("Нет записей на выбранную дату.")
        return

    for idx, (name, parts) in enumerate(sorted(items, key=lambda item: item[0].lower())):
        print(format_exercise_line(name, parts))
        if idx != len(items) - 1:
            print()


if __name__ == "__main__":
    main()
