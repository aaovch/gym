### Сайт

Онлайн-версия: https://aaovch.github.io/gym/

- **Сегодня** — план на выбранную дату
- **Статистика** — 1ПМ, лучшие сеты, графики
- **Запись** — добавление и редактирование тренировок

Данные хранятся в `data/workouts.json` в репозитории. Для записи нужен GitHub token (кнопка **GitHub** в шапке сайта).

### CLI (опционально)

План на сегодня:

```bash
python .\get_today_plan.py
```

На конкретную дату:

```bash
python .\get_today_plan.py --date 2025-10-23
```

Статистика и графики:

```bash
python .\workout_stats.py summary
python .\workout_stats.py day --date 2025-10-23
python .\workout_stats.py trend
```

Перед деплоем сайта JSON для статики собирается так:

```bash
python .\scripts\export_workout_data.py
```

Фильтры `workout_stats.py`:

- `--exercise "присед"` — оставить только упражнения с подстрокой
- `--from 2025-09-01 --to 2025-12-31` — ограничить диапазон дат
