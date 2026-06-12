### Сайт

Онлайн-версия: https://aaovch.github.io/gym/

- **Сегодня** — план на выбранную дату
- **Карта** — блоки движений и графики по зонам
- **История** — хронология подходов по упражнению
- **Статистика** — 1ПМ, лучшие сеты, графики
- **Запись** — добавление и редактирование тренировок

### Хранение данных

Единый формат — JSON v4 в `data/workouts.json`. Старые v1–v3 мигрируют при загрузке:

```json
{
  "version": 4,
  "revision": 1,
  "updatedAt": "2026-06-11T12:00:00",
  "exercises": [
    { "id": "squat", "n": "Приседания со штангой на спине", "k": "strength" }
  ],
  "logs": [
    {
      "id": "uuid",
      "exerciseId": "squat",
      "date": "2026-05-21",
      "blocks": [
        {
          "kind": "strength",
          "sets": [{"weightKg": 100, "reps": 5}, {"weightKg": 110, "reps": 5}],
          "comment": "все кластерно"
        }
      ]
    }
  ]
}
```

**В приложении:** все операции (добавить, изменить, удалить) работают сразу — данные сохраняются локально в браузере.

**GitHub (опционально):** кнопка **GitHub** в шапке → token → «Отправить в GitHub». Тогда копия уходит в репозиторий, и сайт пересобирается через 1–2 минуты.

### CLI (опционально)

План на сегодня:

```bash
python .\get_today_plan.py
```

Статистика:

```bash
python .\workout_stats.py summary
python .\workout_stats.py day --date 2025-10-23
python .\workout_stats.py trend
```

Перед локальной сборкой сайта:

```bash
python .\scripts\export_workout_data.py
cd web
npm run build
```
