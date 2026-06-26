"""Sync workouts.json and cycle-plan exerciseSessions from Obsidian markdown."""

from __future__ import annotations

import json
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from workout_data import validate_workout_v4  # noqa: E402

DEFAULT_MD = Path(
    r"c:\Users\aaovc\Documents\my-obsidian-vault\Personal Notes\План тренировок в качалке.md"
)
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_JSON = ROOT / "data" / "workouts.json"
STATIC_JSON = ROOT / "web" / "static" / "data" / "workouts.json"
CYCLE_PLAN = ROOT / "data" / "cycle-plan.json"
STATIC_PLAN = ROOT / "web" / "static" / "data" / "cycle-plan.json"

EXERCISE_ALIASES: dict[str, str] = {
    "Приседания со штангой на спине": "prisedaniya-so-shtangoy-na-spine",
    "Скоростные прыжки на тумбу": "skorostnye-pryzhki-na-tumbu-napryzhka",
}

BODYWEIGHT_KG = 100

# Obsidian block → session index (A=0, B=1)
BLOCK_SESSIONS: dict[int, list[int]] = {
    1: [0],
    2: [1],
    0: [0, 1],  # общий блок (бег)
}


def _parse_number(text: str) -> float:
    cleaned = text.strip().replace(",", ".")
    match = re.search(r"\d+(?:\.\d+)?", cleaned)
    if not match:
        raise ValueError(f"Cannot parse number from {text!r}")
    return float(match.group(0))


SET_TOKEN_RE = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*×\s*(\d+(?:[.,]\d+)?|свой\s+вес)|"
    r"(свой\s+вес)\s*×\s*(\d+(?:[.,]\d+)?)",
    re.IGNORECASE,
)


def parse_sets_cell(cell: str) -> list[tuple[float, float]]:
    cell = re.sub(r"\([^)]*\)", "", cell).strip().rstrip("?")
    sets: list[tuple[float, float]] = []
    for match in SET_TOKEN_RE.finditer(cell):
        left, right, bw_left, bw_reps = match.groups()
        if bw_left:
            sets.append((BODYWEIGHT_KG, _parse_number(bw_reps)))
            continue
        left = left.strip()
        right = right.strip()
        if "свой вес" in right.lower():
            sets.append((BODYWEIGHT_KG, _parse_number(left)))
        else:
            sets.append((_parse_number(left), _parse_number(right)))
    return sets


def parse_markdown(path: Path) -> dict[str, dict]:
    text = path.read_text(encoding="utf-8")
    exercises: dict[str, dict] = {}
    current_exercise: str | None = None
    current_kind = "strength"
    current_block = 1

    for line in text.splitlines():
        block_heading = re.match(r"^## (\d+) блок", line)
        if block_heading:
            current_block = int(block_heading.group(1))
            continue
        if line.strip() == "## Общий блок":
            current_block = 0
            continue

        heading = re.match(r"^### (.+)$", line)
        if heading:
            name = heading.group(1).strip()
            if name.startswith("Скоростные прыжки на тумбу (Напрыжка)"):
                current_exercise = "Скоростные прыжки на тумбу"
                current_kind = "jumps"
            elif name.startswith("Скоростные прыжки на тумбу на одной ноге"):
                current_exercise = "Скоростные прыжки на тумбу на одной ноге"
                current_kind = "jumps"
            elif name == "Бег":
                current_exercise = "Бег"
                current_kind = "run"
                current_block = 0
            else:
                current_exercise = name
                current_kind = "strength"
            exercises.setdefault(
                current_exercise,
                {"kind": current_kind, "block": current_block, "dates": {}},
            )
            continue

        row = re.match(r"^\| (\d{4}-\d{2}-\d{2}) \| (.+?) \|", line)
        if row and current_exercise:
            date = row.group(1)
            sets = parse_sets_cell(row.group(2))
            if sets:
                exercises[current_exercise]["dates"][date] = sets

    return exercises


def norm_sets(sets: list[tuple[float, float]]) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for w, r in sets:
        w = int(w) if float(w) == int(w) else round(float(w), 1)
        r = int(r) if float(r) == int(r) else round(float(r), 1)
        out.append((w, r))
    return out


def resolve_exercise_id(name: str, by_name: dict[str, str]) -> str:
    if name in EXERCISE_ALIASES:
        return EXERCISE_ALIASES[name]
    if name in by_name:
        return by_name[name]
    raise ValueError(f"Exercise not in catalog: {name}")


def log_sets(log: dict, by_id: dict[str, dict]) -> list[tuple[float, float]]:
    ex = by_id.get(log["exerciseId"], {})
    kind = ex.get("k", "strength")
    sets: list[tuple[float, float]] = []
    for block in log.get("blocks", []):
        block_kind = block.get("kind", kind)
        for s in block.get("sets", []):
            if block_kind == "run":
                sets.append((s["durationMin"], s["speedKmh"]))
            elif block_kind == "jumps":
                sets.append((s["setCount"], s["repsPerSet"]))
            else:
                sets.append((s["weightKg"], s["reps"]))
    return norm_sets(sets)


def sets_to_blocks(kind: str, sets: list[tuple[float, float]]) -> list[dict]:
    stored_sets = []
    for w, r in sets:
        if kind == "run":
            stored_sets.append({"durationMin": w, "speedKmh": r})
        elif kind == "jumps":
            stored_sets.append({"setCount": w, "repsPerSet": r})
        else:
            stored_sets.append({"weightKg": w, "reps": r})
    return [{"kind": kind, "sets": stored_sets}]


def build_obsidian_index(
    md: dict[str, dict], by_name: dict[str, str]
) -> tuple[set[tuple[str, str]], dict[str, int], set[str]]:
    valid_keys: set[tuple[str, str]] = set()
    block_by_id: dict[str, int] = {}
    tracked_ids: set[str] = set()

    for ex_name, data in md.items():
        ex_id = resolve_exercise_id(ex_name, by_name)
        tracked_ids.add(ex_id)
        block_by_id[ex_id] = data["block"]
        for date in data["dates"]:
            valid_keys.add((ex_id, date))

    return valid_keys, block_by_id, tracked_ids


def compare(
    md: dict[str, dict], raw: dict
) -> tuple[list, list, list]:
    by_id = {e["id"]: e for e in raw["exercises"]}
    by_name = {e["n"]: e["id"] for e in raw["exercises"]}
    valid_keys, _, tracked_ids = build_obsidian_index(md, by_name)

    json_by_key: dict[tuple[str, str], tuple[dict, list]] = {}
    for log in raw["logs"]:
        key = (log["exerciseId"], log["date"])
        json_by_key[key] = (log, log_sets(log, by_id))

    missing: list[tuple[str, str, str, list]] = []
    mismatch: list[tuple[str, str, str, list, list]] = []
    extra: list[tuple[str, str, list]] = []

    for ex_name, data in md.items():
        ex_id = resolve_exercise_id(ex_name, by_name)
        for date, md_sets in data["dates"].items():
            md_norm = norm_sets(md_sets)
            key = (ex_id, date)
            if key not in json_by_key:
                missing.append((ex_name, ex_id, date, md_norm))
            elif json_by_key[key][1] != md_norm:
                mismatch.append((ex_name, ex_id, date, md_norm, json_by_key[key][1]))

    for key, (_, sets) in json_by_key.items():
        ex_id, date = key
        if ex_id in tracked_ids and key not in valid_keys:
            name = by_id.get(ex_id, {}).get("n", ex_id)
            extra.append((name, date, sets))

    return missing, mismatch, extra


def sync_workouts(md: dict[str, dict], raw: dict, dry_run: bool) -> list[str]:
    by_name = {e["n"]: e["id"] for e in raw["exercises"]}
    valid_keys, _, tracked_ids = build_obsidian_index(md, by_name)
    missing, mismatch, extra = compare(md, raw)
    changes: list[str] = []

    logs_by_key = {(log["exerciseId"], log["date"]): log for log in raw["logs"]}

    for ex_name, ex_id, date, md_sets, _ in mismatch:
        kind = md[ex_name]["kind"]
        log = logs_by_key[(ex_id, date)]
        log["blocks"] = sets_to_blocks(kind, md_sets)
        changes.append(f"updated {ex_name} @ {date}")

    for ex_name, ex_id, date, md_sets in missing:
        kind = md[ex_name]["kind"]
        new_log = {
            "id": str(uuid.uuid4()),
            "exerciseId": ex_id,
            "date": date,
            "blocks": sets_to_blocks(kind, md_sets),
        }
        raw["logs"].append(new_log)
        logs_by_key[(ex_id, date)] = new_log
        changes.append(f"added {ex_name} @ {date}")

    raw["logs"].sort(key=lambda log: (log["date"], log["exerciseId"]))
    return changes


def sync_cycle_plan_sessions(
    md: dict[str, dict], plan: dict, exercises: list[dict], dry_run: bool
) -> list[str]:
    by_name = {e["n"]: e["id"] for e in exercises}
    _, block_by_id, _ = build_obsidian_index(md, by_name)
    changes: list[str] = []
    for meso in plan.get("mesocycles", []):
        meso_dates = {
            session.get("date")
            for micro in meso.get("microcycles", [])
            for session in micro.get("sessions", [])
            if session.get("date")
        }
        desired: dict[str, list[int]] = {}
        for ex_name, data in md.items():
            if not any(date in meso_dates for date in data["dates"]):
                continue
            ex_id = resolve_exercise_id(ex_name, by_name)
            desired[ex_id] = BLOCK_SESSIONS[data["block"]]

        if meso.get("exerciseSessions") == desired:
            continue
        meso["exerciseSessions"] = desired.copy()
        changes.append(
            f"{meso.get('label', meso.get('id'))}: {len(desired)} exerciseSessions from Obsidian dates"
        )
    return changes


def save_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def run(md_path: Path, dry_run: bool) -> dict:
    md = parse_markdown(md_path)
    raw = json.loads(DEFAULT_JSON.read_text(encoding="utf-8"))
    plan = json.loads(CYCLE_PLAN.read_text(encoding="utf-8"))

    missing, mismatch, extra = compare(md, raw)
    workout_changes = sync_workouts(md, raw, dry_run)
    plan_changes = sync_cycle_plan_sessions(md, plan, raw["exercises"], dry_run)

    if not dry_run and (workout_changes or plan_changes):
        updated_at = (
            datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        )
        if workout_changes:
            validate_workout_v4(raw)
            raw["revision"] = int(raw.get("revision", 0)) + 1
            raw["updatedAt"] = updated_at
            save_json(DEFAULT_JSON, raw)
            if STATIC_JSON.parent.exists():
                save_json(STATIC_JSON, raw)
        if plan_changes:
            plan["revision"] = int(plan.get("revision", 0)) + 1
            plan["updatedAt"] = updated_at
            save_json(CYCLE_PLAN, plan)
            if STATIC_PLAN.parent.exists():
                save_json(STATIC_PLAN, plan)

    return {
        "missing": len(missing),
        "mismatch": len(mismatch),
        "extra": len(extra),
        "workout_changes": workout_changes,
        "plan_changes": plan_changes,
        "dry_run": dry_run,
    }


def main() -> None:
    dry_run = "--dry-run" in sys.argv
    md_path = Path(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith("-") else DEFAULT_MD

    result = run(md_path, dry_run)
    print(
        f"{'Dry run' if dry_run else 'Applied'}: "
        f"missing={result['missing']} mismatch={result['mismatch']} extra={result['extra']}"
    )
    for line in result["workout_changes"] + result["plan_changes"]:
        print(f"  {line}")


if __name__ == "__main__":
    main()
