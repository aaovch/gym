<script lang="ts">
  import { base } from '$app/paths';
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import TrendChart from '$lib/components/TrendChart.svelte';
  import { fmtNum, fmtSet, formatDateRu, todayIso } from '$lib/format';
  import { workoutStore } from '$lib/workout-store';
  import type { StrengthSummary, TrendPoint } from '$lib/types';

  let query = $state('');
  let selectedLocal = $state<string | null>(null);

  const urlExercise = $derived.by(() => (browser ? page.url.searchParams.get('exercise') : null));
  const selectedExercise = $derived(selectedLocal ?? urlExercise ?? null);
  const view = $derived(workoutStore.view);
  const strengthSummary = $derived(
    view.summary.filter((item): item is StrengthSummary => item.kind === 'strength')
  );
  const filtered = $derived(
    strengthSummary
      .filter((item) => item.exercise.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => b.sessions - a.sessions)
  );
  const trendPoints = $derived<TrendPoint[]>(
    selectedExercise ? (view.trend[selectedExercise] ?? []) : []
  );
  const selectedSummary = $derived(
    selectedExercise
      ? strengthSummary.find((item) => item.exercise === selectedExercise) ?? null
      : null
  );
  const trainingDays = $derived(new Set(view.sessions.map((session) => session.date)).size);
  const last30Start = $derived.by(() => {
    const date = new Date(`${todayIso()}T12:00:00`);
    date.setDate(date.getDate() - 29);
    return date.toISOString().slice(0, 10);
  });
  const recentDays = $derived(
    new Set(
      view.sessions.filter((session) => session.date >= last30Start).map((session) => session.date)
    ).size
  );
  const totalSets = $derived(
    view.sessions.reduce(
      (total, session) =>
        total + session.rows.reduce((rowTotal, row) => rowTotal + row.sets.length, 0),
      0
    )
  );
  const strongest = $derived(
    [...strengthSummary].sort((a, b) => b.best1rm.value - a.best1rm.value).slice(0, 5)
  );
  const mostPracticed = $derived([...strengthSummary].sort((a, b) => b.sessions - a.sessions).slice(0, 5));

  function selectExercise(name: string) {
    selectedLocal = selectedExercise === name ? null : name;
  }
</script>

<div class="container">
  <header class="page-header">
    <div>
      <div class="eyebrow">Прогресс и закономерности</div>
      <h1>Аналитика</h1>
      <p>
        Регулярность тренировок, силовые показатели и динамика упражнений на основе вашего журнала.
      </p>
    </div>
    <a class="button button-secondary" href="{base}/load">Нагрузка по блокам</a>
  </header>

  <section class="metric-grid">
    <article class="metric-card">
      <span>Тренировочных дней</span>
      <strong>{trainingDays}</strong>
      <small>за всё время</small>
    </article>
    <article class="metric-card">
      <span>За последние 30 дней</span>
      <strong>{recentDays}</strong>
      <small>{recentDays >= 12 ? 'стабильный ритм' : 'можно добавить регулярности'}</small>
    </article>
    <article class="metric-card">
      <span>Всего подходов</span>
      <strong>{totalSets}</strong>
      <small>во всех типах нагрузок</small>
    </article>
    <article class="metric-card">
      <span>Силовых упражнений</span>
      <strong>{strengthSummary.length}</strong>
      <small>с рассчитанным прогрессом</small>
    </article>
  </section>

  <section class="insight-grid">
    <article class="card insight-card">
      <div class="insight-heading">
        <div>
          <div class="eyebrow">По расчётному 1ПМ</div>
          <h2>Самые сильные движения</h2>
        </div>
      </div>
      <div class="ranking">
        {#each strongest as item, index (item.exercise)}
          <button type="button" onclick={() => selectExercise(item.exercise)}>
            <span class="rank">{index + 1}</span>
            <span class="rank-name">{item.exercise}</span>
            <strong>{fmtNum(item.best1rm.value)} кг</strong>
          </button>
        {/each}
      </div>
    </article>

    <article class="card insight-card">
      <div class="insight-heading">
        <div>
          <div class="eyebrow">По числу сессий</div>
          <h2>Основа программы</h2>
        </div>
      </div>
      <div class="ranking">
        {#each mostPracticed as item, index (item.exercise)}
          <button type="button" onclick={() => selectExercise(item.exercise)}>
            <span class="rank">{index + 1}</span>
            <span class="rank-name">{item.exercise}</span>
            <strong>{item.sessions}</strong>
          </button>
        {/each}
      </div>
    </article>
  </section>

  {#if selectedExercise && selectedSummary}
    <div class="section-heading">
      <div>
        <h2>{selectedExercise}</h2>
        <p>Динамика расчётного максимума по тренировочным датам</p>
      </div>
      <div class="chart-actions">
        <a class="button button-ghost" href="{base}/history?exercise={encodeURIComponent(selectedExercise)}">
          История
        </a>
        <button class="button button-ghost" type="button" onclick={() => (selectedLocal = null)}>
          Закрыть
        </button>
      </div>
    </div>
    <section class="card chart-card">
      <div class="selected-summary">
        <div>
          <span>Лучший 1ПМ</span>
          <strong>{fmtNum(selectedSummary.best1rm.value)} кг</strong>
        </div>
        <div>
          <span>Лучший подход</span>
          <strong>{fmtSet(selectedSummary.bestWeight.weight, selectedSummary.bestWeight.reps)}</strong>
        </div>
        <div>
          <span>Сессий</span>
          <strong>{selectedSummary.sessions}</strong>
        </div>
        <div>
          <span>Последний результат</span>
          <strong>{selectedSummary.periodEnd ? formatDateRu(selectedSummary.periodEnd) : '—'}</strong>
        </div>
      </div>
      <TrendChart title="Расчётный 1ПМ" points={trendPoints} />
    </section>
  {/if}

  <div class="section-heading">
    <div>
      <h2>Все силовые упражнения</h2>
      <p>Выберите строку, чтобы открыть график</p>
    </div>
    <input class="search" type="search" placeholder="Найти упражнение" bind:value={query} />
  </div>

  <section class="card table-card">
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Упражнение</th>
            <th>Сессий</th>
            <th>Расчётный 1ПМ</th>
            <th>Лучший подход</th>
            <th>Средняя интенсивность</th>
            <th>Последняя запись</th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as item (item.exercise)}
            <tr class:selected={selectedExercise === item.exercise} onclick={() => selectExercise(item.exercise)}>
              <td><strong>{item.exercise}</strong></td>
              <td>{item.sessions}</td>
              <td>
                <strong>{fmtNum(item.best1rm.value)} кг</strong>
                <span>{item.best1rm.date ? formatDateRu(item.best1rm.date) : '—'}</span>
              </td>
              <td>
                {fmtSet(item.bestWeight.weight, item.bestWeight.reps)}
                <span>{item.bestWeight.date ? formatDateRu(item.bestWeight.date) : '—'}</span>
              </td>
              <td>{fmtNum(item.avgIntensity)} кг</td>
              <td>{item.periodEnd ? formatDateRu(item.periodEnd) : '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
</div>

<style>
  .insight-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-top: 16px;
  }

  .insight-card {
    padding: 20px;
  }

  .insight-heading h2 {
    margin: 5px 0 15px;
    font-size: 18px;
  }

  .ranking {
    display: grid;
  }

  .ranking button {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto;
    gap: 9px;
    align-items: center;
    padding: 10px 0;
    color: var(--text);
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--line);
    cursor: pointer;
    text-align: left;
  }

  .ranking button:last-child {
    border-bottom: 0;
  }

  .rank {
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    color: var(--muted);
    background: var(--surface-soft);
    border-radius: 0;
    font-size: 9px;
  }

  .rank-name {
    overflow: hidden;
    font-size: 12px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ranking strong {
    color: var(--accent);
    font-size: 12px;
  }

  .chart-actions {
    display: flex;
    gap: 7px;
  }

  .chart-card {
    padding: 20px;
  }

  .selected-summary {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
    margin-bottom: 20px;
  }

  .selected-summary div {
    padding: 12px;
    background: var(--surface-soft);
    border: 1px solid var(--line);
    border-radius: 0;
  }

  .selected-summary span,
  .selected-summary strong {
    display: block;
  }

  .selected-summary span {
    color: var(--muted);
    font-size: 9px;
  }

  .selected-summary strong {
    margin-top: 6px;
    font-size: 14px;
  }

  .search {
    width: 230px;
  }

  .table-card {
    overflow: hidden;
  }

  .table-wrap {
    overflow-x: auto;
  }

  tbody tr {
    cursor: pointer;
    transition: background 120ms ease;
  }

  tbody tr:hover,
  tbody tr.selected {
    background: rgb(185 243 90 / 5%);
  }

  td span {
    display: block;
    margin-top: 3px;
    color: var(--muted);
    font-size: 9px;
  }

  @media (max-width: 850px) {
    .insight-grid {
      grid-template-columns: 1fr;
    }

    .selected-summary {
      grid-template-columns: 1fr 1fr;
    }
  }

  @media (max-width: 560px) {
    .search {
      width: 100%;
    }

    .chart-actions {
      width: 100%;
    }

    .chart-actions .button {
      flex: 1;
    }
  }
</style>
