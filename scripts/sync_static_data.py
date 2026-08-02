"""Sync shared and per-profile JSON data → web/static/data/ (minified)."""

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


def validate_profiles(name: str, raw: dict) -> None:
    if raw.get("version") != 1:
        raise SystemExit(f"{name}: expected version 1, got {raw.get('version')!r}")
    profiles = raw.get("profiles")
    if not isinstance(profiles, list) or not profiles:
        raise SystemExit(f"{name}: profiles must be a non-empty list")
    _check_unique_ids(name, "profile id", profiles)
    ids = {item.get("id") for item in profiles if isinstance(item, dict)}
    if raw.get("defaultProfileId") not in ids:
        raise SystemExit(f"{name}: defaultProfileId must reference an existing profile")
    exercise_catalog_path = raw.get("exerciseCatalogPath")
    if (
        not isinstance(exercise_catalog_path, str)
        or not exercise_catalog_path.startswith("data/")
        or not exercise_catalog_path.endswith("workouts.json")
        or ".." in exercise_catalog_path
        or "\\" in exercise_catalog_path
    ):
        raise SystemExit(f"{name}: invalid exerciseCatalogPath")
    url_slugs: set[str] = set()
    for profile in profiles:
        if not isinstance(profile, dict):
            raise SystemExit(f"{name}: every profile must be an object")
        url_slug = profile.get("urlSlug")
        if not isinstance(url_slug, str) or not url_slug or url_slug in url_slugs:
            raise SystemExit(f"{name}: invalid or duplicate urlSlug for profile {profile.get('id')!r}")
        if any(char not in "abcdefghijklmnopqrstuvwxyz0123456789-" for char in url_slug):
            raise SystemExit(f"{name}: invalid urlSlug for profile {profile.get('id')!r}")
        url_slugs.add(url_slug)
        for key, file_name in (("workoutsPath", "workouts.json"), ("cyclePlanPath", "cycle-plan.json")):
            value = profile.get(key)
            if not isinstance(value, str) or not value.startswith("data/") or not value.endswith(file_name):
                raise SystemExit(f"{name}: invalid {key} for profile {profile.get('id')!r}")
            if ".." in value or "\\" in value:
                raise SystemExit(f"{name}: unsafe {key} for profile {profile.get('id')!r}")


def minify_json(path: Path, relative_path: Path | None = None) -> dict:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if path.name == "workouts.json" and raw.get("version") != 4:
        raise SystemExit(f"{path.name}: expected version 4, got {raw.get('version')!r}")
    if path.name == "cycle-plan.json" and raw.get("version") != 4:
        raise SystemExit(f"{path.name}: expected version 4, got {raw.get('version')!r}")
    if path.name == "training-theses.json":
        validate_theses(path.name, raw)
    if path.name == "profiles.json":
        validate_profiles(path.name, raw)
    text = json.dumps(raw, ensure_ascii=False, separators=(",", ":"))
    path.write_text(text, encoding="utf-8")
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    out = STATIC_DIR / (relative_path or Path(path.name))
    out.parent.mkdir(parents=True, exist_ok=True)
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

    profiles_path = DATA_DIR / "profiles.json"
    if not profiles_path.exists():
        raise SystemExit(f"Missing profile manifest: {profiles_path}")
    profiles = minify_json(profiles_path)
    print(f"profiles.json: {len(profiles['profiles'])} profiles -> {STATIC_DIR / 'profiles.json'}")

    synced_paths: set[Path] = {Path("profiles.json")}
    for name in ("workouts.json", "training-theses.json", "cycle-plan.json"):
        src = DATA_DIR / name
        if not src.exists():
            print(f"skip missing {name}")
            continue
        raw = minify_json(src)
        synced_paths.add(Path(name))
        if name == "workouts.json":
            print(
                f"{name}: v4, {len(raw.get('exercises', []))} exercises, "
                f"{len(raw.get('logs', []))} logs -> {STATIC_DIR / name}"
            )
        else:
            print(f"{name} -> {STATIC_DIR / name}")

    for profile in profiles["profiles"]:
        for key in ("workoutsPath", "cyclePlanPath"):
            relative = Path(profile[key]).relative_to("data")
            if relative in synced_paths:
                continue
            src = DATA_DIR / relative
            if not src.exists():
                raise SystemExit(f"Missing profile data file: {src}")
            minify_json(src, relative)
            synced_paths.add(relative)
            print(f"{profile['id']}: {relative} -> {STATIC_DIR / relative}")


if __name__ == "__main__":
    main()
