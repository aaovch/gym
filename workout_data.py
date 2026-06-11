"""Workout JSON database helpers."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from pathlib import Path

DEFAULT_DB_PATH = Path(__file__).resolve().parent / "data" / "workouts.json"

CYRILLIC = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def _transliterate_ru(text: str) -> str:
    return "".join(CYRILLIC.get(char, char) for char in text.lower())


def _slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", _transliterate_ru(name)).strip("-")[:48]
    return base or "exercise"


def _round_num(value: float) -> float | int:
    if float(value).is_integer():
        return int(value)
    return round(float(value), 1)


def expand_workout_v3(stored: dict) -> dict:
    by_id = {item["id"]: item["n"] for item in stored.get("exercises", [])}
    sessions: list[dict] = []
    for log in stored.get("logs", []):
        exercise = by_id.get(log["e"], log["e"])
        rows = []
        for row in log.get("rows", []):
            sets = [[float(w), float(r)] for w, r in row.get("s", [])]
            if not sets:
                continue
            rows.append({"sets": sets, "comment": row.get("c")})
        if rows:
            sessions.append(
                {
                    "id": log["id"],
                    "exercise": exercise,
                    "exerciseId": log["e"],
                    "date": log["d"],
                    "rows": rows,
                    "microSessionId": log.get("ms"),
                }
            )
    return {
        "version": 3,
        "updatedAt": stored.get("updatedAt", ""),
        "exercises": stored.get("exercises", []),
        "logs": stored.get("logs", []),
        "sessions": sessions,
    }


def compact_workout_v3(db: dict) -> dict:
    exercises = db.get("exercises", [])
    if not exercises or not isinstance(exercises[0], dict):
        raise ValueError("Expected v3 exercise catalog")

    by_name = {item["n"]: item["id"] for item in exercises if "n" in item}
    logs = []
    for session in db.get("sessions", []):
        rows = []
        for row in session.get("rows", []):
            sets = [
                [_round_num(w), _round_num(r)]
                for w, r in row.get("sets", [])
                if w and r
            ]
            if not sets:
                continue
            compact_row: dict = {"s": sets}
            comment = row.get("comment")
            if isinstance(comment, str) and comment.strip():
                compact_row["c"] = comment.strip()
            rows.append(compact_row)
        if not rows:
            continue
        entry: dict = {
            "id": session["id"],
            "e": session.get("exerciseId") or by_name[session["exercise"]],
            "d": session["date"],
            "rows": rows,
        }
        if session.get("microSessionId"):
            entry["ms"] = session["microSessionId"]
        logs.append(entry)

    return {
        "version": 3,
        "updatedAt": db.get("updatedAt", ""),
        "exercises": exercises,
        "logs": logs,
    }


def normalize_workout(raw: dict) -> dict:
    if raw.get("version") != 3 or "logs" not in raw:
        raise ValueError(f"Expected workouts.json v3 with logs, got version={raw.get('version')!r}")
    return expand_workout_v3(raw)


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


def create_session(
    exercise: str,
    date: str,
    rows: list[dict],
    session_id: str | None = None,
) -> dict:
    return {
        "id": session_id or str(uuid.uuid4()),
        "exercise": exercise,
        "date": date,
        "rows": rows,
    }


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
        return {
            "version": 3,
            "updatedAt": datetime.now().isoformat(timespec="seconds"),
            "exercises": [],
            "logs": [],
            "sessions": [],
        }
    return normalize_workout(json.loads(db_path.read_text(encoding="utf-8")))


def save_database(db: dict, path: Path | None = None) -> None:
    db_path = path or DEFAULT_DB_PATH
    runtime = normalize_workout(db)
    stored = compact_workout_v3(runtime)
    stored["updatedAt"] = datetime.now().isoformat(timespec="seconds")
    db_path.parent.mkdir(parents=True, exist_ok=True)
    db_path.write_text(
        json.dumps(stored, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
