"""Sync data/*.json → web/static/data/ (v4, minified)."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
STATIC_DIR = ROOT / "web" / "static" / "data"


def _check_unique_ids(name: str, label: str, items: object) -> None:
    if not isinstance(items, list):
        return
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        item_id = item.get("id")
        if not isinstance(item_id, str):
            continue
        if item_id in seen:
            raise SystemExit(f"{name}: дубликат {label}: {item_id}")
        seen.add(item_id)


def validate_theses(name: str, raw: dict) -> None:
    """Ранняя проверка уникальности id групп и тезисов (защита от регресса дублей)."""
    groups = raw.get("groups")
    _check_unique_ids(name, "group id", groups)
    all_theses: list[dict] = []
    if isinstance(groups, list):
        for group in groups:
            if isinstance(group, dict) and isinstance(group.get("theses"), list):
                all_theses.extend(t for t in group["theses"] if isinstance(t, dict))
    _check_unique_ids(name, "thesis id", all_theses)


def minify_json(path: Path) -> dict:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if path.name == "workouts.json" and raw.get("version") != 4:
        raise SystemExit(f"{path.name}: expected version 4, got {raw.get('version')!r}")
    if path.name == "cycle-plan.json" and raw.get("version") != 4:
        raise SystemExit(f"{path.name}: expected version 4, got {raw.get('version')!r}")
    if path.name == "training-theses.json":
        validate_theses(path.name, raw)
    text = json.dumps(raw, ensure_ascii=False, separators=(",", ":"))
    path.write_text(text, encoding="utf-8")
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    out = STATIC_DIR / path.name
    out.write_text(text, encoding="utf-8")
    return raw


def main() -> None:
    if not DATA_DIR.exists():
        raise SystemExit(f"Missing data dir: {DATA_DIR}")

    cycle_plan = DATA_DIR / "cycle-plan.json"
    if not cycle_plan.exists():
        cycle_plan.write_text(
            json.dumps(
                {
                    "version": 4,
                    "revision": 0,
                    "updatedAt": "",
                    "templates": [],
                    "macrocycles": [],
                    "mesocycles": [],
                },
                ensure_ascii=False,
                separators=(",", ":"),
            ),
            encoding="utf-8",
        )

    for name in ("workouts.json", "training-theses.json", "cycle-plan.json"):
        src = DATA_DIR / name
        if not src.exists():
            print(f"skip missing {name}")
            continue
        raw = minify_json(src)
        if name == "workouts.json":
            print(
                f"{name}: v4, {len(raw.get('exercises', []))} exercises, "
                f"{len(raw.get('logs', []))} logs -> {STATIC_DIR / name}"
            )
        else:
            print(f"{name} -> {STATIC_DIR / name}")


if __name__ == "__main__":
    main()
