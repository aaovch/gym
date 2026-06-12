"""Sync data/*.json → web/static/data/ (v4, minified)."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
STATIC_DIR = ROOT / "web" / "static" / "data"


def minify_json(path: Path) -> dict:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if path.name == "workouts.json" and raw.get("version") != 4:
        raise SystemExit(f"{path.name}: expected version 4, got {raw.get('version')!r}")
    if path.name == "cycle-plan.json" and raw.get("version") != 4:
        raise SystemExit(f"{path.name}: expected version 4, got {raw.get('version')!r}")
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
