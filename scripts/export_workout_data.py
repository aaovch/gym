"""Copy workout JSON database into the static site folder."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "workouts.json"
OUT_PATH = ROOT / "web" / "static" / "data" / "workouts.json"


def main() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"Database not found: {DB_PATH}")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(DB_PATH, OUT_PATH)

    db = json.loads(DB_PATH.read_text(encoding="utf-8"))
    sessions = len(db.get("sessions", []))
    print(f"Copied {sessions} sessions to {OUT_PATH}")


if __name__ == "__main__":
    main()
