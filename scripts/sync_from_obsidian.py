"""Sync workouts.json from Obsidian markdown source of truth."""

from __future__ import annotations

import json
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_MD = Path(
    r"c:\Users\aaovc\Documents\my-obsidian-vault\Personal Notes\План тренировок в качалке.md"
)
DEFAULT_JSON = Path(__file__).resolve().parent.parent / "data" / "workouts.json"
STATIC_JSON = Path(__file__).resolve().parent.parent / "web" / "static" / "data" / "workouts.json"

# Obsidian heading -> workouts.json exercise id
EXERCISE_ALIASES: dict[str, str] = {
    "Приседания со штангой на спине": "prisedaniya-so-shtangoy-na-spine",
    "Скоростные прыжки на тумбу": "skorostnye-pryzhki-na-tumbu-napryzhka",
}

BODYWEIGHT_KG = 100


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


def parse_sets_cell(cell: str, kind: str) -> list[tuple[float, float]]:
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

    for line in text.splitlines():
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
            else:
                current_exercise = name
                current_kind = "strength"
            exercises.setdefault(current_exercise, {"kind": current_kind, "dates": {}})
            continue

        row = re.match(r"^\| (\d{4}-\d{2}-\d{2}) \| (.+?) \|", line)
        if row and current_exercise:
            date = row.group(1)
            sets = parse_sets_cell(row.group(2), current_kind)
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


def resolve_exercise_id(name: str, by_name: dict[str, str], by_id: dict[str, dict]) -> str:
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


def compare(md: dict[str, dict], raw: dict) -> tuple[list, list]:
    by_id = {e["id"]: e for e in raw["exercises"]}
    by_name = {e["n"]: e["id"] for e in raw["exercises"]}

    json_by_key: dict[tuple[str, str], tuple[dict, list]] = {}
    for log in raw["logs"]:
        sets = log_sets(log, by_id)
        json_by_key[(log["exerciseId"], log["date"])] = (log, sets)

    missing: list[tuple[str, str, str, list]] = []
    mismatch: list[tuple[str, str, str, list, list]] = []

    for ex_name, data in md.items():
        ex_id = resolve_exercise_id(ex_name, by_name, by_id)
        kind = data["kind"]
        for date, md_sets in data["dates"].items():
            md_norm = norm_sets(md_sets)
            key = (ex_id, date)
            if key not in json_by_key:
                missing.append((ex_name, ex_id, date, md_norm))
            elif json_by_key[key][1] != md_norm:
                mismatch.append((ex_name, ex_id, date, md_norm, json_by_key[key][1]))

    return missing, mismatch


def sync(md_path: Path, json_path: Path, dry_run: bool = False) -> dict:
    md = parse_markdown(md_path)
    raw = json.loads(json_path.read_text(encoding="utf-8"))
    by_id = {e["id"]: e for e in raw["exercises"]}
    by_name = {e["n"]: e["id"] for e in raw["exercises"]}

    missing, mismatch = compare(md, raw)
    changes: list[str] = []

    logs_by_key: dict[tuple[str, str], dict] = {
        (log["exerciseId"], log["date"]): log for log in raw["logs"]
    }

    for ex_name, ex_id, date, md_sets, _ in mismatch:
        kind = md[ex_name]["kind"]
        log = logs_by_key.get((ex_id, date))
        if log:
            log["blocks"] = sets_to_blocks(kind, md_sets)
            changes.append(f"updated {ex_name} @ {date}: {md_sets}")

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
        changes.append(f"added {ex_name} @ {date}: {md_sets}")

    raw["logs"].sort(key=lambda log: (log["date"], log["exerciseId"]))

    if changes and not dry_run:
        raw["revision"] = int(raw.get("revision", 0)) + 1
        raw["updatedAt"] = (
            datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        )
        text = json.dumps(raw, ensure_ascii=False, separators=(",", ":"))
        json_path.write_text(text, encoding="utf-8")
        if STATIC_JSON.parent.exists():
            STATIC_JSON.write_text(text, encoding="utf-8")

    return {"missing": len(missing), "mismatch": len(mismatch), "changes": changes, "dry_run": dry_run}


def main() -> None:
    dry_run = "--dry-run" in sys.argv
    md_path = DEFAULT_MD
    json_path = DEFAULT_JSON

    missing, mismatch = compare(parse_markdown(md_path), json.loads(json_path.read_text(encoding="utf-8")))

    report_path = Path(__file__).resolve().parent.parent / "sync_report.txt"
    lines = [
        f"Missing in JSON: {len(missing)}",
        f"Mismatch: {len(mismatch)}",
        "",
    ]
    for ex_name, ex_id, date, sets in missing:
        lines.append(f"  + {ex_name} @ {date}: {sets}")
    for ex_name, ex_id, date, md_sets, js_sets in mismatch:
        lines.append(f"  ~ {ex_name} @ {date}")
        lines.append(f"      MD:   {md_sets}")
        lines.append(f"      JSON: {js_sets}")

    report_path.write_text("\n".join(lines), encoding="utf-8")

    result = sync(md_path, json_path, dry_run=dry_run)
    summary = (
        f"Dry run — would apply {len(result['changes'])} changes"
        if dry_run
        else f"Applied {len(result['changes'])} changes"
    )
    report_path.write_text("\n".join(lines) + "\n\n" + summary + "\n", encoding="utf-8")
    print(summary)
    print(f"Report: {report_path}")


if __name__ == "__main__":
    main()
