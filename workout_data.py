"""Shared workout database helpers (JSON source of truth)."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from pathlib import Path

from workout_stats import parse_sets_cell

COMMENT_RE = re.compile(r"\(([^)]+)\)\s*$")
DEFAULT_DB_PATH = Path(__file__).resolve().parent / "data" / "workouts.json"


def extract_comment(cell: str) -> str | None:
    match = COMMENT_RE.search(cell.strip())
    return match.group(1).strip() if match else None


def part_to_row(part: str) -> dict:
    comment = extract_comment(part)
    cleaned = COMMENT_RE.sub("", part).strip()
    sets = parse_sets_cell(cleaned if cleaned else part)
    return {
        "sets": [[weight, reps] for weight, reps in sets],
        "comment": comment,
    }


def entry_to_session(entry: dict, session_id: str | None = None) -> dict:
    rows = [part_to_row(part) for part in entry.get("parts", []) if part.strip()]
    if not rows and entry.get("sets"):
        rows = [{"sets": [[weight, reps] for weight, reps in entry["sets"]], "comment": None}]
    return {
        "id": session_id or str(uuid.uuid4()),
        "exercise": entry["exercise"],
        "date": entry["date"],
        "rows": rows,
    }


def sessions_to_entries(sessions: list[dict]) -> list[dict]:
    entries: list[dict] = []
    for session in sessions:
        parts: list[str] = []
        sets: list[tuple[float, float]] = []
        for row in session.get("rows", []):
            row_sets = [(float(w), float(r)) for w, r in row.get("sets", [])]
            if not row_sets:
                continue
            cell = _format_sets_cell(row_sets, row.get("comment"))
            parts.append(cell)
            sets.extend(row_sets)
        if not sets:
            continue
        entries.append(
            {
                "id": session.get("id"),
                "exercise": session["exercise"],
                "date": session["date"],
                "parts": parts,
                "sets": sets,
            }
        )
    return entries


def _format_weight(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))
    return str(value).replace(".", ",")


def _format_sets_cell(sets: list[tuple[float, float]], comment: str | None = None) -> str:
    body = ", ".join(f"{_format_weight(w)}×{_format_weight(r)}" for w, r in sets)
    if comment:
        return f"{body} ({comment})"
    return body


def load_database(path: Path | None = None) -> dict:
    db_path = path or DEFAULT_DB_PATH
    if not db_path.exists():
        return {"version": 1, "updatedAt": datetime.now().isoformat(timespec="seconds"), "sessions": []}
    return json.loads(db_path.read_text(encoding="utf-8"))


def save_database(db: dict, path: Path | None = None) -> None:
    db_path = path or DEFAULT_DB_PATH
    db["updatedAt"] = datetime.now().isoformat(timespec="seconds")
    db_path.parent.mkdir(parents=True, exist_ok=True)
    db_path.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8")
