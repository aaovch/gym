"""One-time migration from markdown log to JSON database."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from workout_data import entry_to_session, save_database  # noqa: E402
from workout_stats import parse_markdown  # noqa: E402

MD_PATH = ROOT / "План тренировок в качалке.md"
OUT_PATH = ROOT / "data" / "workouts.json"


def main() -> None:
    md_text = MD_PATH.read_text(encoding="utf-8")
    entries = parse_markdown(md_text)
    sessions = [entry_to_session(entry) for entry in entries]
    db = {"version": 1, "updatedAt": "", "sessions": sessions}
    save_database(db, OUT_PATH)
    print(f"Migrated {len(sessions)} sessions to {OUT_PATH}")


if __name__ == "__main__":
    main()
