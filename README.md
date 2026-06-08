### Как получить план на сегодня

Запустите в PowerShell из папки проекта:

```bash
python .\get_today_plan.py
```

### Пример на конкретную дату

```bash
python .\get_today_plan.py --date 2025-10-23 --include-cont
```

### Собрать статистику

Агрегированная по упражнениям + PNG-графики по каждому упражнению.
Для силовых упражнений показываются лучший сет/1ПМ/~5RM, а для бега и прыжков — профильные метрики (время, скорость, объём):

```bash
python .\workout_stats.py summary
```

Графики сохраняются в `.\summary_plots`. Можно указать другую папку:

```bash
python .\workout_stats.py summary --plots-dir .\my_plots
```

Упражнения без новых записей несколько месяцев автоматически кладутся в `.\summary_plots\inactive`.
Порог и название подпапки можно менять:

```bash
python .\workout_stats.py summary --inactive-months 4 --inactive-subdir old
```

Те же метрики только за конкретную дату:

```bash
python .\workout_stats.py day --date 2025-10-23
```

Динамика по датам (только 1ПМ Эпли):

```bash
python .\workout_stats.py trend
```

Фильтры:

- `--exercise "присед"` — оставить только упражнения с подстрокой.
- `--from 2025-09-01 --to 2025-12-31` — ограничить диапазон дат.


