import argparse
import datetime as dt
import re
from collections import defaultdict
from pathlib import Path
from typing import Iterable

try:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    MATPLOTLIB_AVAILABLE = True
except ImportError:
    MATPLOTLIB_AVAILABLE = False

TABLE_ROW_RE = re.compile(r"^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(.*?)\|.*$")
CONT_ROW_RE = re.compile(r"^\|\s*\|\s*(.*?)\|.*$")
SET_RE = re.compile(r"^\s*([\d.,]+)\s*[x×]\s*([\d.,]+)\s*$")


def _normalize(cell: str) -> str:
    """Trim spaces and trailing commas."""
    return cell.strip().rstrip(",")


def parse_sets_cell(cell: str) -> list[tuple[float, float]]:
    """Parse a single table cell like `100×5, 105×5 (кластерно)` into (weight, reps)."""
    cleaned = re.sub(r"\([^)]*\)", "", cell)  # drop comments in parentheses
    parts = [p.strip() for p in cleaned.split(",") if p.strip()]
    result: list[tuple[float, float]] = []
    for part in parts:
        m = SET_RE.match(part)
        if not m:
            continue
        weight_raw, reps_raw = m.groups()
        weight = float(weight_raw.replace(",", "."))
        reps = float(reps_raw.replace(",", "."))
        result.append((weight, reps))
    return result


def parse_markdown(md_text: str) -> list[dict]:
    """
    Parse the entire markdown file into entries:
    [{exercise, date, parts: raw strings, sets: [(weight, reps), ...]}].
    Continuation rows are merged into the same date entry.
    """
    entries: list[dict] = []
    current_exercise: str | None = None
    pending: dict | None = None
    collecting = False

    lines = md_text.splitlines()
    for line in lines:
        if line.startswith("### "):
            if pending:
                entries.append(pending)
            current_exercise = line.replace("### ", "").strip()
            pending = None
            collecting = False
            continue

        m = TABLE_ROW_RE.match(line)
        if m and current_exercise:
            if pending:
                entries.append(pending)
            date_str, sets_cell = m.group(1), _normalize(m.group(2))
            pending = {
                "exercise": current_exercise,
                "date": date_str,
                "parts": [sets_cell] if sets_cell else [],
            }
            collecting = True
            continue

        if collecting and pending:
            m2 = CONT_ROW_RE.match(line)
            if m2:
                more = _normalize(m2.group(1))
                if more:
                    pending["parts"].append(more)
                continue
            else:
                entries.append(pending)
                pending = None
                collecting = False

    if pending:
        entries.append(pending)

    for entry in entries:
        parsed_sets: list[tuple[float, float]] = []
        for cell in entry["parts"]:
            parsed_sets.extend(parse_sets_cell(cell))
        entry["sets"] = parsed_sets

    # Keep only entries where sets were parsed
    return [e for e in entries if e["sets"]]


def epley_1rm(weight: float, reps: float) -> float:
    """Epley formula for 1RM estimation."""
    return weight * (1 + reps / 30)


def _best_set_by_weight(sets: list[tuple[float, float]]) -> tuple[float, float]:
    """Return set with maximal weight, tie-break by higher reps."""
    return max(sets, key=lambda x: (x[0], x[1]))


def _best_set_by_1rm(sets: list[tuple[float, float]]) -> tuple[float, float, float]:
    """Return (weight, reps, est1rm) for the set with maximal estimated 1RM."""
    best = max(sets, key=lambda x: epley_1rm(*x))
    return best[0], best[1], epley_1rm(*best)


def _best_set_near_reps(
    sets: list[tuple[float, float]], low: int, high: int
) -> tuple[float, float] | None:
    """Best weight among sets whose reps fall into [low, high]."""
    candidates = [s for s in sets if low <= s[1] <= high]
    if not candidates:
        return None
    return max(candidates, key=lambda x: (x[0], x[1]))


def compute_entry_metrics(entry: dict) -> dict:
    sets = entry["sets"]
    tonnage = sum(w * r for w, r in sets)
    max_weight_set = _best_set_by_weight(sets)
    best_1rm_set = _best_set_by_1rm(sets)
    best5 = _best_set_near_reps(sets, 4, 6)
    total_reps = sum(r for _, r in sets)
    est_1rm = best_1rm_set[2]
    avg_intensity = tonnage / total_reps if total_reps else 0.0
    return {
        "tonnage": tonnage,
        "max_weight": max_weight_set[0],
        "max_weight_set": max_weight_set,
        "est_1rm": est_1rm,
        "est_1rm_set": (best_1rm_set[0], best_1rm_set[1]),
        "best5": best5,
        "reps": total_reps,
        "sets": len(sets),
        "avg_intensity": avg_intensity,
    }


def _filter_entries(
    entries: Iterable[dict],
    exercise_filters: list[str] | None,
    date_from: dt.date | None,
    date_to: dt.date | None,
) -> list[dict]:
    def match_exercise(name: str) -> bool:
        if not exercise_filters:
            return True
        name_l = name.lower()
        return any(f.lower() in name_l for f in exercise_filters)

    filtered = []
    for entry in entries:
        if not match_exercise(entry["exercise"]):
            continue
        entry_date = dt.date.fromisoformat(entry["date"])
        if date_from and entry_date < date_from:
            continue
        if date_to and entry_date > date_to:
            continue
        filtered.append(entry)
    return filtered


def aggregate_by_exercise(entries: list[dict]) -> list[dict]:
    grouped: dict[str, dict] = defaultdict(
        lambda: {
            "exercise": "",
            "sessions": 0,
            "sets": 0,
            "reps": 0,
            "tonnage": 0.0,
            "avg_intensity_sum": 0.0,
            "max_weight": (0.0, None, None),  # (weight, reps, date)
            "best_1rm": (0.0, None, None),  # (1RM, (w, r), date)
            "best5": (0.0, None, None),  # (weight, reps, date)
            "max_reps": (0.0, None, None),  # (reps, weight, date)
            "max_volume_set": (0.0, None, None, None),  # (w*r, w, r, date)
            "dates": [],
        }
    )

    for entry in entries:
        g = grouped[entry["exercise"]]
        g["exercise"] = entry["exercise"]
        g["sessions"] += 1
        metrics = compute_entry_metrics(entry)
        g["sets"] += metrics["sets"]
        g["reps"] += metrics["reps"]
        g["tonnage"] += metrics["tonnage"]
        g["avg_intensity_sum"] += metrics["avg_intensity"]

        # best weight set
        if metrics["max_weight"] > g["max_weight"][0]:
            mw_w, mw_r = metrics["max_weight_set"]
            g["max_weight"] = (mw_w, mw_r, entry["date"])

        # best 1RM estimate
        if metrics["est_1rm"] > g["best_1rm"][0]:
            g["best_1rm"] = (metrics["est_1rm"], metrics["est_1rm_set"], entry["date"])

        # best ~5RM
        if metrics["best5"]:
            best5_weight, best5_reps = metrics["best5"]
            if best5_weight > g["best5"][0]:
                g["best5"] = (best5_weight, best5_reps, entry["date"])

        # maximum reps in any parsed set
        max_reps_set = max(entry["sets"], key=lambda x: x[1])
        if max_reps_set[1] > g["max_reps"][0]:
            g["max_reps"] = (max_reps_set[1], max_reps_set[0], entry["date"])

        # set with maximum volume (weight * reps)
        max_volume_set = max(entry["sets"], key=lambda x: x[0] * x[1])
        max_volume_val = max_volume_set[0] * max_volume_set[1]
        if max_volume_val > g["max_volume_set"][0]:
            g["max_volume_set"] = (
                max_volume_val,
                max_volume_set[0],
                max_volume_set[1],
                entry["date"],
            )

        g["dates"].append(entry["date"])

    return sorted(grouped.values(), key=lambda x: x["exercise"].lower())


def print_summary(groups: list[dict]) -> None:
    if not groups:
        print("Нет записей по выбранным фильтрам.")
        return

    for g in groups:
        period = f"{min(g['dates'])} — {max(g['dates'])}" if g["dates"] else "-"
        avg_intensity = g["avg_intensity_sum"] / g["sessions"] if g["sessions"] else 0.0
        chart_kind = _exercise_chart_kind(g["exercise"])
        best_1rm_val, best_1rm_set, best_1rm_date = g["best_1rm"]
        print(g["exercise"])
        print(
            f"  сессий: {g['sessions']}, подходов: {g['sets']}, повторов: {_fmt_num(g['reps'])}"
        )
        if chart_kind == "run":
            duration, speed, d_date = g["max_weight"]
            max_dist, dur_at_dist, speed_at_dist, dist_date = g["max_volume_set"]
            max_speed, dur_at_speed, speed_date = g["max_reps"]
            if d_date:
                print(f"  макс. время: {duration:.1f} (дата {d_date})")
            if speed_date:
                print(f"  макс. скорость: {max_speed:.1f} (дата {speed_date})")
            if dist_date:
                print(
                    f"  макс. дистанция: {max_dist:.1f} (сессия {dur_at_dist:.1f}x{speed_at_dist:.1f}, дата {dist_date})"
                )
            print(f"  средняя дистанция на сессию: {(g['tonnage'] / g['sessions']) if g['sessions'] else 0.0:.1f}")
        elif chart_kind == "jumps":
            sets_cnt, reps_in_set, sets_date = g["max_weight"]
            max_reps, sets_at_max_reps, reps_date = g["max_reps"]
            max_volume, sets_at_volume, reps_at_volume, volume_date = g["max_volume_set"]
            if sets_date:
                print(f"  макс. подходов в сессии: {sets_cnt:.0f} (дата {sets_date})")
            if reps_date:
                print(f"  макс. повторов в подходе: {max_reps:.0f} (дата {reps_date})")
            if volume_date:
                print(
                    f"  макс. объём сессии: {max_volume:.0f} (сессия {sets_at_volume:.0f}x{reps_at_volume:.0f}, дата {volume_date})"
                )
            print(
                f"  средний объём на сессию: {(g['tonnage'] / g['sessions']) if g['sessions'] else 0.0:.1f}"
            )
        else:
            if g["max_weight"][1]:
                w, r, d = g["max_weight"]
                print(f"  лучший сет по весу: {_fmt_set(w, r)} (дата {d})")
            if best_1rm_date:
                w, r = best_1rm_set
                print(
                    f"  лучшая 1ПМ (Эпли): {best_1rm_val:.1f} кг (сет {_fmt_set(w, r)}, дата {best_1rm_date})"
                )
            if g["best5"][1]:
                w5, r5, d5 = g["best5"]
                print(f"  лучший ~5RM: {_fmt_set(w5, r5)} (дата {d5})")
            print(f"  ср. интенсивность (тоннаж/повтор): {avg_intensity:.1f} кг")
        print(f"  период: {period}")
        print()


def _safe_filename(name: str) -> str:
    slug = re.sub(r"[^\w\- ]+", "", name, flags=re.UNICODE).strip().lower()
    slug = re.sub(r"\s+", "_", slug)
    return slug or "exercise"


def _exercise_chart_kind(exercise_name: str) -> str:
    name = exercise_name.lower()
    if "бег" in name:
        return "run"
    if "прыж" in name:
        return "jumps"
    return "strength"


def save_summary_plots(
    groups: list[dict],
    trend: dict[str, list[dict]],
    out_dir: Path,
    inactive_months: int = 3,
    inactive_subdir: str = "inactive",
) -> tuple[int, int]:
    """Save per-exercise trend charts for summary mode."""
    if not groups or not MATPLOTLIB_AVAILABLE:
        return 0, 0

    out_dir.mkdir(parents=True, exist_ok=True)
    inactive_dir = out_dir / inactive_subdir
    saved = 0
    inactive_saved = 0
    all_dates = [dt.date.fromisoformat(d) for g in groups for d in g["dates"]]
    ref_date = max(all_dates) if all_dates else dt.date.today()
    cutoff_date = ref_date - dt.timedelta(days=30 * inactive_months)

    for g in groups:
        exercise = g["exercise"]
        points = trend.get(exercise, [])
        if not points:
            continue

        dates = [dt.date.fromisoformat(p["date"]) for p in points]
        est_1rm = [p["est_1rm"] for p in points]
        max_weight = [p["max_set"][0] for p in points]
        aux_value = [p["max_set"][1] for p in points]
        volume = [p["max_set"][0] * p["max_set"][1] for p in points]
        avg_intensity = [p["avg_intensity"] for p in points]
        chart_kind = _exercise_chart_kind(exercise)

        fig, ax = plt.subplots(figsize=(10, 5))
        if chart_kind == "run":
            ax.plot(dates, max_weight, marker="o", label="Время")
            ax.plot(dates, aux_value, marker="s", label="Скорость")
            ax.plot(dates, volume, marker="^", label="Дистанция (время x скорость)")
            ax.set_ylabel("Условные единицы")
        elif chart_kind == "jumps":
            ax.plot(dates, max_weight, marker="o", label="Подходов")
            ax.plot(dates, aux_value, marker="s", label="Повторов в подходе")
            ax.plot(dates, volume, marker="^", label="Общий объём (подходы x повторы)")
            ax.set_ylabel("Повторы")
        else:
            ax.plot(dates, est_1rm, marker="o", label="1ПМ (Эпли), кг")
            ax.plot(dates, max_weight, marker="s", label="Лучший вес сета, кг")
            ax.plot(dates, avg_intensity, marker="^", label="Ср. интенсивность, кг")
            ax.set_ylabel("Килограммы")
        ax.set_title(exercise)
        ax.set_xlabel("Дата")
        ax.grid(True, alpha=0.3)
        ax.legend()
        fig.autofmt_xdate()
        fig.tight_layout()

        filename = f"{_safe_filename(exercise)}.png"
        target_dir = out_dir
        if inactive_months > 0:
            last_date = dt.date.fromisoformat(max(g["dates"]))
            if last_date < cutoff_date:
                inactive_dir.mkdir(parents=True, exist_ok=True)
                target_dir = inactive_dir
                inactive_saved += 1
        fig.savefig(target_dir / filename, dpi=160)
        plt.close(fig)
        saved += 1

    return saved, inactive_saved


def print_day(entries: list[dict], target_date: str) -> None:
    if not entries:
        print("Нет записей по выбранным фильтрам.")
        return

    print(f"Дата: {target_date}")
    for entry in sorted(entries, key=lambda e: e["exercise"].lower()):
        metrics = compute_entry_metrics(entry)
        set_desc = ", ".join(_fmt_set(w, r) for w, r in entry["sets"])
        print(entry["exercise"])
        print(f"  подходы: {set_desc}")
        print(
            f"  тоннаж: {metrics['tonnage']:.1f} кг, пик: {metrics['max_weight']:.1f} кг, 1ПМ (Эпли): {metrics['est_1rm']:.1f} кг"
        )
        print()


def _fmt_num(value: float) -> str:
    return str(int(value)) if value.is_integer() else str(round(value, 2))


def _fmt_set(weight: float, reps: float | None) -> str:
    if reps is None:
        return _fmt_num(weight)
    return f"{_fmt_num(weight)}x{_fmt_num(reps)}"


def build_trend(entries: list[dict]) -> dict[str, list[dict]]:
    """Group per exercise; keep one point per date with best sets/metrics."""
    grouped: dict[str, dict[str, dict]] = defaultdict(dict)
    for entry in entries:
        metrics = compute_entry_metrics(entry)
        exercise = entry["exercise"]
        date = entry["date"]
        grouped[exercise][date] = {
            "date": date,
            "max_set": metrics["max_weight_set"],
            "best5": metrics["best5"],
            "est_1rm": metrics["est_1rm"],
            "est_1rm_set": metrics["est_1rm_set"],
            "avg_intensity": metrics["avg_intensity"],
        }

    # sort by date inside each exercise
    result: dict[str, list[dict]] = {}
    for ex, by_date in grouped.items():
        result[ex] = [by_date[d] for d in sorted(by_date.keys())]
    return result


def print_trend(trend: dict[str, list[dict]]) -> None:
    if not trend:
        print("Нет записей по выбранным фильтрам.")
        return

    for ex in sorted(trend.keys()):
        print(ex)
        for p in trend[ex]:
            est_w, est_r = p["est_1rm_set"]
            print(
                f"  {p['date']}: 1ПМ (Эпли) {p['est_1rm']:.1f} кг (сет { _fmt_set(est_w, est_r) })"
            )
        print()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Показать статистику по тренировкам из markdown-таблиц"
    )
    parser.add_argument(
        "file",
        nargs="?",
        type=Path,
        default=None,
        help="Путь к markdown (по умолчанию рядом со скриптом: 'План тренировок в качалке.md')",
    )
    parser.add_argument("--from", dest="date_from", help="С какой даты (YYYY-MM-DD)")
    parser.add_argument("--to", dest="date_to", help="По какую дату (YYYY-MM-DD)")
    parser.add_argument(
        "--exercise",
        action="append",
        help="Фильтр по названию упражнения (подстрока, можно несколько флагов)",
    )
    sub = parser.add_subparsers(dest="mode", required=True)
    summary_parser = sub.add_parser("summary", help="Агрегированная статистика по упражнениям")
    summary_parser.add_argument(
        "--plots-dir",
        type=Path,
        default=Path("summary_plots"),
        help="Папка для PNG-графиков по упражнениям (по умолчанию: ./summary_plots)",
    )
    summary_parser.add_argument(
        "--inactive-months",
        type=int,
        default=3,
        help="Через сколько месяцев без записей упражнение считать неактуальным (по умолчанию: 3)",
    )
    summary_parser.add_argument(
        "--inactive-subdir",
        default="inactive",
        help="Название подпапки для неактуальных упражнений (по умолчанию: inactive)",
    )
    day_parser = sub.add_parser("day", help="Статистика за конкретную дату")
    day_parser.add_argument(
        "--date", required=True, help="Дата тренировки (YYYY-MM-DD)"
    )
    sub.add_parser("trend", help="Динамика по датам (1ПМ Эпли)")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.date_from:
        date_from = dt.date.fromisoformat(args.date_from)
    else:
        date_from = None

    if args.date_to:
        date_to = dt.date.fromisoformat(args.date_to)
    else:
        date_to = None

    if args.file is not None:
        md_path = args.file
    else:
        md_path = Path(__file__).with_name("План тренировок в качалке.md")

    entries = parse_markdown(md_path.read_text(encoding="utf-8"))
    entries = _filter_entries(entries, args.exercise, date_from, date_to)

    if args.mode == "summary":
        groups = aggregate_by_exercise(entries)
        print_summary(groups)
        if not MATPLOTLIB_AVAILABLE:
            print("Графики не построены: установите matplotlib (`pip install matplotlib`).")
        else:
            trend = build_trend(entries)
            saved, inactive_saved = save_summary_plots(
                groups,
                trend,
                args.plots_dir,
                inactive_months=args.inactive_months,
                inactive_subdir=args.inactive_subdir,
            )
            if saved:
                print(f"Сохранено графиков: {saved} (папка: {args.plots_dir.resolve()})")
                if inactive_saved:
                    print(
                        f"В подпапку неактуальных перенесено: {inactive_saved} "
                        f"(папка: {(args.plots_dir / args.inactive_subdir).resolve()})"
                    )
            else:
                print("Графики не построены: нет подходящих точек для выбранных фильтров.")
    elif args.mode == "day":
        day_entries = [e for e in entries if e["date"] == args.date]
        print_day(day_entries, args.date)
    elif args.mode == "trend":
        trend = build_trend(entries)
        print_trend(trend)


if __name__ == "__main__":
    main()
