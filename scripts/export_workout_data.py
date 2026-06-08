"""Build static workout snapshot for the Svelte site from JSON database."""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from workout_data import load_database, sessions_to_entries  # noqa: E402
from workout_stats import (  # noqa: E402
    _exercise_chart_kind,
    aggregate_by_exercise,
    build_trend,
)

DB_PATH = ROOT / "data" / "workouts.json"
OUT_PATH = ROOT / "web" / "static" / "data" / "workouts.json"


def _serialize_summary(groups: list[dict]) -> list[dict]:
    result = []
    for g in groups:
        kind = _exercise_chart_kind(g["exercise"])
        best_1rm_val, best_1rm_set, best_1rm_date = g["best_1rm"]
        max_w, max_r, max_date = g["max_weight"]
        best5_w, best5_r, best5_date = g["best5"]

        item = {
            "exercise": g["exercise"],
            "kind": kind,
            "sessions": g["sessions"],
            "sets": g["sets"],
            "reps": g["reps"],
            "tonnage": round(g["tonnage"], 1),
            "periodStart": min(g["dates"]) if g["dates"] else None,
            "periodEnd": max(g["dates"]) if g["dates"] else None,
            "avgIntensity": round(g["avg_intensity_sum"] / g["sessions"], 1) if g["sessions"] else 0,
        }

        if kind == "strength":
            item["best1rm"] = {
                "value": round(best_1rm_val, 1),
                "weight": best_1rm_set[0] if best_1rm_set else None,
                "reps": best_1rm_set[1] if best_1rm_set else None,
                "date": best_1rm_date,
            }
            item["bestWeight"] = {
                "weight": max_w,
                "reps": max_r,
                "date": max_date,
            }
            item["best5"] = {
                "weight": best5_w,
                "reps": best5_r,
                "date": best5_date,
            } if best5_w else None
        elif kind == "run":
            item["maxDuration"] = {"value": max_w, "date": max_date}
            item["maxSpeed"] = {"value": g["max_reps"][0], "date": g["max_reps"][2]}
            vol = g["max_volume_set"]
            item["maxDistance"] = {
                "value": vol[0],
                "duration": vol[1],
                "speed": vol[2],
                "date": vol[3],
            }
        else:
            item["maxSets"] = {"value": max_w, "date": max_date}
            item["maxRepsInSet"] = {
                "value": g["max_reps"][0],
                "date": g["max_reps"][2],
            }
            vol = g["max_volume_set"]
            item["maxVolume"] = {
                "value": vol[0],
                "sets": vol[1],
                "reps": vol[2],
                "date": vol[3],
            }

        result.append(item)
    return result


def _serialize_trend(trend: dict[str, list[dict]]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for exercise, points in trend.items():
        out[exercise] = [
            {
                "date": p["date"],
                "est1rm": round(p["est_1rm"], 1),
                "maxWeight": p["max_set"][0],
                "maxReps": p["max_set"][1],
                "avgIntensity": round(p["avg_intensity"], 1),
            }
            for p in points
        ]
    return out


def main() -> None:
    db = load_database(DB_PATH)
    entries = sessions_to_entries(db["sessions"])
    groups = aggregate_by_exercise(entries)
    trend = build_trend(entries)

    payload = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "updatedAt": db.get("updatedAt"),
        "sessions": db["sessions"],
        "entries": [
            {
                "id": e.get("id"),
                "exercise": e["exercise"],
                "date": e["date"],
                "parts": e["parts"],
                "sets": [[w, r] for w, r in e["sets"]],
            }
            for e in entries
        ],
        "summary": _serialize_summary(groups),
        "trend": _serialize_trend(trend),
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT_PATH} ({len(entries)} entries, {len(groups)} exercises)")


if __name__ == "__main__":
    main()
