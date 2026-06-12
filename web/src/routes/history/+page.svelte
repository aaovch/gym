<script lang="ts">
  import { page } from '$app/state';
  import { browser } from '$app/environment';
  import { base } from '$app/paths';
  import { formatDateRu, fmtNum } from '$lib/format';
  import type { ExerciseKind, ExerciseSet, WorkoutSession } from '$lib/types';
  import { workoutStore } from '$lib/workout-store';

  let exerciseLocal = $state('');
  let query = $state('');
  let sortOrder = $state<'new' | 'old'>('new');
  let visibleDays = $state(12);

  const urlExercise = $derived.by(() => (browser ? page.url.searchParams.get('exercise') : null));
  const exercise = $derived(exerciseLocal || urlExercise || '');
  const view = $derived(workoutStore.view);
  const exerciseKinds = $derived(
    new Map(view.entries.map((entry) => [entry.exercise, entry.kind] as const))
  );
  const exercises = $derived(
    [...new Set(view.sessions.map((session) => session.exercise))].sort((a, b) =>
      a.localeCompare(b, 'ru')
    )
  );
  const filteredExercises = $derived(
    exercises.filter((name) => name.toLowerCase().includes(query.trim().toLowerCase()))
  );
  const selectedSessions = $derived(
    view.sessions
      .filter((session) => !exercise.trim() || session.exercise === exercise.trim())
      .sort((a, b) =>
        sortOrder === 'new' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)
      )
  );
  const groupedDays = $derived.by(() => {
    const groups = new Map<string, WorkoutSession[]>();
    for (const session of selectedSessions) {
      const bucket = groups.get(session.date) ?? [];
      bucket.push(session);
      groups.set(session.date, bucket);
    }
    return [...groups.entries()].slice(0, exercise.trim() ? Number.POSITIVE_INFINITY : visibleDays);
  });
  const selectedKind = $derived(exercise.trim() ? exerciseKinds.get(exercise.trim()) ?? 'strength' : null);
  const selectedSummary = $derived(
    exercise.trim() ? view.summary.find((item) => item.exercise === exercise.trim()) ?? null : null
  );
  const totalSets = $derived(
    selectedSessions.reduce(
      (total, session) =>
        total + session.rows.reduce((rowTotal, row) => rowTotal + row.sets.length, 0),
      0
    )
  );
  const trainingDays = $derived(new Set(view.sessions.map((session) => session.date)).size);
  const period = $derived.by(() => {
    const dates = view.sessions.map((session) => session.date).sort();
    return dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null;
  });

  function setLabel(kind: ExerciseKind, set: ExerciseSet): string {
    const [first, second] = set;
    if (kind === 'run') return `${first} мин · ${second} км/ч`;
    if (kind === 'jumps') return `${first} подх. × ${second}`;
    return `${first} кг × ${second}`;
  }

  function sessionKind(session: WorkoutSession): ExerciseKind {
    return exerciseKinds.get(session.exercise) ?? session.rows[0]?.kind ?? 'strength';
  }
</script>

<div class="container">
  <header class="page-header">
    <div>
      <div class="eyebrow">Дневник тренировок</div>
      <h1>Журнал</h1>
      <p>
        Просматривайте тренировки по датам или выберите упражнение, чтобы увидеть всю его историю.
      </p>
    </div>
    <a class="button button-primary" href="{base}/add">Новая запись</a>
  </header>

  <section class="metric-grid">
    <article class="metric-card">
      <span>Тренировочных дней</span>
      <strong>{trainingDays}</strong>
      <small>за всё время</small>
    </article>
    <article class="metric-card">
      <span>Записей упражнений</span>
      <strong>{view.sessions.length}</strong>
      <small>отдельных движений</small>
    </article>
    <article class="metric-card">
      <span>Упражнений</span>
      <strong>{exercises.length}</strong>
      <small>есть в истории</small>
    </article>
    <article class="metric-card">
      <span>Период данных</span>
      <strong class="period-value">{period ? formatDateRu(period.from) : '—'}</strong>
      <small>{period ? `по ${formatDateRu(period.to)}` : 'журнал пока пуст'}</small>
    </article>
  </section>

  <section class="card filters">
    <label class="exercise-filter">
      Упражнение
      <input
        value={exercise}
        oninput={(event) => (exerciseLocal = event.currentTarget.value)}
        list="history-exercises"
        placeholder="Все упражнения"
      />
      <datalist id="history-exercises">
        {#each exercises as name (name)}
          <option value={name}></option>
        {/each}
      </datalist>
    </label>
    <label>
      Найти в каталоге
      <input bind:value={query} type="search" placeholder="Например, присед" />
    </label>
    <label>
      Порядок
      <select bind:value={sortOrder}>
        <option value="new">Сначала новые</option>
        <option value="old">Сначала старые</option>
      </select>
    </label>
    {#if exercise.trim()}
      <button class="button button-ghost clear-filter" type="button" onclick={() => (exerciseLocal = '')}>
        Показать все
      </button>
    {/if}
  </section>

  {#if query.trim()}
    <div class="exercise-chips">
      {#each filteredExercises.slice(0, 16) as name (name)}
        <button
          type="button"
          class:active={exercise === name}
          onclick={() => {
            exerciseLocal = name;
            query = '';
          }}
        >
          {name}
        </button>
      {/each}
    </div>
  {/if}

  {#if exercise.trim() && selectedSummary}
    <div class="section-heading">
      <div>
        <h2>{exercise}</h2>
        <p>{selectedKind === 'strength' ? 'Силовая история' : selectedKind === 'run' ? 'Беговая история' : 'Прыжковая история'}</p>
      </div>
      <a class="button button-secondary" href="{base}/stats?exercise={encodeURIComponent(exercise)}">
        Открыть аналитику
      </a>
    </div>
    <section class="metric-grid selected-metrics">
      <article class="metric-card">
        <span>Сессий</span>
        <strong>{selectedSessions.length}</strong>
        <small>с этим упражнением</small>
      </article>
      <article class="metric-card">
        <span>Подходов</span>
        <strong>{totalSets}</strong>
        <small>во всех записях</small>
      </article>
      {#if selectedSummary.kind === 'strength'}
        <article class="metric-card accent-metric">
          <span>Лучший расчётный 1ПМ</span>
          <strong>{fmtNum(selectedSummary.best1rm.value)} кг</strong>
          <small>{selectedSummary.best1rm.date ? formatDateRu(selectedSummary.best1rm.date) : '—'}</small>
        </article>
        <article class="metric-card">
          <span>Лучший вес</span>
          <strong>{fmtNum(selectedSummary.bestWeight.weight)} кг</strong>
          <small>{selectedSummary.bestWeight.reps} повторений</small>
        </article>
      {/if}
    </section>
  {/if}

  <div class="section-heading">
    <div>
      <h2>{exercise.trim() ? 'История упражнения' : 'Последние тренировки'}</h2>
      <p>{exercise.trim() ? `${groupedDays.length} тренировочных дней` : 'Сгруппировано по датам'}</p>
    </div>
  </div>

  {#if groupedDays.length === 0}
    <section class="card empty-state">
      <h2>Записей не найдено</h2>
      <p>Смените фильтр или добавьте первую тренировку.</p>
      <a class="button button-primary" href="{base}/add">Добавить тренировку</a>
    </section>
  {:else}
    <section class="timeline">
      {#each groupedDays as [date, sessions] (date)}
        <article class="day-card card">
          <div class="day-heading">
            <div>
              <strong>{formatDateRu(date)}</strong>
              <span>{sessions.length} {sessions.length === 1 ? 'упражнение' : 'упражнений'}</span>
            </div>
            <a class="button button-ghost" href="{base}/?date={date}">Открыть день</a>
          </div>
          <div class="session-list">
            {#each sessions as session (session.id)}
              {@const kind = sessionKind(session)}
              <div class="session-row">
                <div class="session-name">
                  <a href="{base}/history?exercise={encodeURIComponent(session.exercise)}">
                    {session.exercise}
                  </a>
                  <span>{kind === 'strength' ? 'Силовое' : kind === 'run' ? 'Кардио' : 'Прыжки'}</span>
                </div>
                <div class="sets">
                  {#each session.rows as row}
                    {#each row.sets as set}
                      <span>{setLabel(kind, set)}</span>
                    {/each}
                  {/each}
                </div>
                <a class="edit-link" href="{base}/add?id={session.id}">Изменить</a>
              </div>
            {/each}
          </div>
        </article>
      {/each}
    </section>

    {#if !exercise.trim() && groupedDays.length < new Set(selectedSessions.map((item) => item.date)).size}
      <button class="button button-secondary load-more" type="button" onclick={() => (visibleDays += 12)}>
        Показать ещё
      </button>
    {/if}
  {/if}
</div>

<style>
  .period-value {
    font-size: 16px;
  }

  .filters {
    display: grid;
    grid-template-columns: minmax(220px, 2fr) minmax(180px, 1fr) 170px auto;
    gap: 12px;
    align-items: end;
    margin-top: 16px;
    padding: 18px;
  }

  .clear-filter {
    white-space: nowrap;
  }

  .exercise-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin-top: 12px;
  }

  .exercise-chips button {
    padding: 7px 10px;
    color: var(--muted-strong);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 0;
    cursor: pointer;
    font-size: 11px;
  }

  .exercise-chips button.active {
    color: var(--accent);
    border-color: rgb(185 243 90 / 30%);
  }

  .selected-metrics {
    margin-bottom: 5px;
  }

  .accent-metric {
    background: linear-gradient(145deg, rgb(185 243 90 / 10%), var(--surface));
    border-color: rgb(185 243 90 / 22%);
  }

  .timeline {
    display: grid;
    gap: 10px;
  }

  .day-card {
    padding: 0 20px;
  }

  .day-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    padding: 17px 0;
    border-bottom: 1px solid var(--line);
  }

  .day-heading strong,
  .day-heading span {
    display: block;
  }

  .day-heading strong {
    font-size: 15px;
  }

  .day-heading span {
    margin-top: 3px;
    color: var(--muted);
    font-size: 10px;
  }

  .session-row {
    display: grid;
    grid-template-columns: minmax(180px, 0.9fr) minmax(0, 2fr) auto;
    gap: 16px;
    align-items: center;
    padding: 14px 0;
    border-bottom: 1px solid rgb(37 45 61 / 65%);
  }

  .session-row:last-child {
    border-bottom: 0;
  }

  .session-name a,
  .session-name span {
    display: block;
  }

  .session-name a {
    font-size: 13px;
    font-weight: 750;
  }

  .session-name a:hover {
    color: var(--accent);
  }

  .session-name span {
    margin-top: 4px;
    color: var(--muted);
    font-size: 9px;
  }

  .sets {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .sets span {
    padding: 5px 7px;
    color: var(--muted-strong);
    background: #0a0f17;
    border: 1px solid var(--line);
    border-radius: 0;
    font-size: 10px;
  }

  .edit-link {
    color: var(--blue);
    font-size: 10px;
  }

  .load-more {
    display: flex;
    margin: 18px auto 0;
  }

  @media (max-width: 950px) {
    .filters {
      grid-template-columns: 1fr 1fr;
    }
  }

  @media (max-width: 680px) {
    .filters {
      grid-template-columns: 1fr;
    }

    .session-row {
      grid-template-columns: 1fr;
      gap: 9px;
    }
  }
</style>
