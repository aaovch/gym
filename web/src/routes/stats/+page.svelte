<script lang="ts">
  import { base } from '$app/paths';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import TrendChart from '$lib/components/TrendChart.svelte';
  import { fmtNum, fmtSet, formatDateRu, todayIso } from '$lib/format';
  import {
    SORT_OPTIONS,
    PERIOD_PRESETS,
    buildAnalyticsInsights,
    exerciseColor,
    presetPeriodRange,
    recentPrRecords as listRecentPrRecords,
    sortStrengthSummary,
    sparklinePath,
    statsUrl,
    summarizeTrendPeriod,
    type DateRange,
    type PeriodPresetKey,
    type SortKey
  } from '$lib/stats-analytics';
  import { workoutStore } from '$lib/workout-store';
  import type { StrengthSummary, TrendPoint } from '$lib/types';

  let query = $state('');
  let sortKey = $state<SortKey>('sessions');
  let periodRange = $state<DateRange | null>(null);
  let periodPreset = $state<PeriodPresetKey>('all');

  const view = $derived(workoutStore.view);
  const strengthSummary = $derived(
    view.summary.filter((item): item is StrengthSummary => item.kind === 'strength')
  );
  const selectedExercise = $derived.by(() => {
    const raw = page.url.searchParams.get('exercise');
    if (!raw) return null;
    return strengthSummary.some((item) => item.exercise === raw) ? raw : null;
  });
  const filtered = $derived(
    strengthSummary.filter((item) =>
      item.exercise.toLowerCase().includes(query.trim().toLowerCase())
    )
  );
  const sortedExercises = $derived(sortStrengthSummary(filtered, sortKey));
  const catalogRows = $derived(
    sortedExercises.map((item) => {
      const points = view.trend[item.exercise] ?? [];
      return {
        item,
        color: exerciseColor(item.exercise),
        sparkPath: sparklinePath(points)
      };
    })
  );
  const trendPoints = $derived<TrendPoint[]>(
    selectedExercise ? (view.trend[selectedExercise] ?? []) : []
  );
  const periodSummary = $derived(summarizeTrendPeriod(trendPoints, periodRange));
  const periodSets = $derived.by(() => {
    if (!selectedExercise) return 0;
    return view.sessions
      .filter((session) => {
        if (session.exercise !== selectedExercise) return false;
        if (!periodRange) return true;
        return session.date >= periodRange.from && session.date <= periodRange.to;
      })
      .reduce(
        (total, session) =>
          total + session.rows.reduce((rowTotal, row) => rowTotal + row.sets.length, 0),
        0
      );
  });
  const displayDelta = $derived(periodSummary?.deltaPct ?? null);
  const usingPeriod = $derived(periodRange != null && periodSummary != null);
  const selectedSummary = $derived(
    selectedExercise
      ? (strengthSummary.find((item) => item.exercise === selectedExercise) ?? null)
      : null
  );
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
  const recentPrRecords = $derived(listRecentPrRecords(strengthSummary, last30Start));
  const strongest = $derived(
    [...strengthSummary].sort((a, b) => b.best1rm.value - a.best1rm.value).slice(0, 5)
  );
  const mostPracticed = $derived(
    [...strengthSummary].sort((a, b) => b.sessions - a.sessions).slice(0, 5)
  );
  const max1rm = $derived(Math.max(...strongest.map((item) => item.best1rm.value), 1));
  const maxSessions = $derived(Math.max(...mostPracticed.map((item) => item.sessions), 1));
  const chartColor = $derived(selectedExercise ? exerciseColor(selectedExercise) : '#6ee7a8');
  const insights = $derived(buildAnalyticsInsights({ recentDays, strongest }));

  function setExerciseParam(name: string | null) {
    const params = new URLSearchParams(page.url.searchParams);
    if (name) params.set('exercise', name);
    else params.delete('exercise');
    goto(statsUrl(base, params), { keepFocus: true, noScroll: true, replaceState: true });
  }

  function selectExercise(name: string) {
    setExerciseParam(selectedExercise === name ? null : name);
  }

  function clearSelection() {
    setExerciseParam(null);
  }

  function resetPeriod() {
    periodRange = null;
    periodPreset = 'all';
  }

  function applyPeriodPreset(key: PeriodPresetKey) {
    periodPreset = key;
    if (key === 'all') {
      periodRange = null;
      return;
    }
    const preset = PERIOD_PRESETS.find((item) => item.key === key);
    periodRange = preset ? presetPeriodRange(trendPoints, preset.days) : null;
  }

  function setPeriodRange(range: DateRange | null) {
    periodRange = range;
    periodPreset = range ? 'custom' : 'all';
  }

  $effect(() => {
    selectedExercise;
    resetPeriod();
  });

  function shareWidth(value: number, max: number): number {
    return max ? (value / max) * 100 : 0;
  }
</script>

{#snippet rankRow(
  item: StrengthSummary,
  index: number,
  mode: '1rm' | 'sessions',
  max: number
)}
  <li>
    <button type="button" onclick={() => selectExercise(item.exercise)}>
      <span class="rank-no">{index + 1}</span>
      <span class="rank-body">
        <strong>{item.exercise}</strong>
        <span
          class={['rank-bar', mode === 'sessions' && 'sessions']}
          style:width="{shareWidth(mode === '1rm' ? item.best1rm.value : item.sessions, max)}%"
        ></span>
      </span>
      <em>
        {mode === '1rm' ? `${fmtNum(item.best1rm.value)} кг` : item.sessions}
      </em>
    </button>
  </li>
{/snippet}

<div class="container analytics">
  <header class="page-header">
    <div>
      <div class="eyebrow">Прогресс и закономерности</div>
      <h1>Аналитика</h1>
      <p>Силовые показатели, регулярность и динамика 1ПМ по журналу тренировок.</p>
    </div>
    <div class="header-actions">
      <a class="button button-secondary" href="{base}/history">Журнал</a>
      <a class="button button-ghost" href="{base}/load">Нагрузка по блокам</a>
    </div>
  </header>

  {#if !workoutStore.bootstrapped}
    <section class="card skeleton-panel" aria-busy="true" aria-label="Загрузка аналитики">
      <div class="skeleton workspace-skeleton"></div>
    </section>
  {:else if strengthSummary.length === 0}
    <section class="card empty-state">
      <h2>Пока нет силовых данных</h2>
      <p>
        Запишите несколько силовых тренировок — здесь появятся графики 1ПМ, рейтинги упражнений
        и сводка по регулярности.
      </p>
      <a class="button button-primary" href="{base}/add">Записать тренировку</a>
    </section>
  {:else}
    {#if recentPrRecords.length > 0}
      <section class="recent-prs card" aria-label="Новые рекорды 1ПМ за 30 дней">
        <div class="recent-prs-head">
          <div>
            <span class="eyebrow">Новые 1ПМ</span>
            <h2>За последние 30 дней</h2>
          </div>
          <span class="recent-prs-count">{recentPrRecords.length}</span>
        </div>
        <ul class="recent-prs-list">
          {#each recentPrRecords as record (record.exercise)}
            <li>
              <button
                type="button"
                class={['recent-pr-item', selectedExercise === record.exercise && 'active']}
                style:--ex-color={exerciseColor(record.exercise)}
                onclick={() => selectExercise(record.exercise)}
              >
                <span class="recent-pr-name">{record.exercise}</span>
                <span class="recent-pr-value">{fmtNum(record.value)}<small>кг</small></span>
                <span class="recent-pr-date">{formatDateRu(record.date)}</span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <div class="analytics-workspace">
      <aside class="catalog card">
        <div class="catalog-head">
          <div>
            <h2>Упражнения</h2>
            <p>{sortedExercises.length} в каталоге</p>
          </div>
          <input
            class="search"
            type="search"
            placeholder="Найти…"
            bind:value={query}
            aria-label="Поиск упражнения"
          />
          <div class="sort-row" role="tablist" aria-label="Сортировка">
            {#each SORT_OPTIONS as option (option.key)}
              <button
                type="button"
                role="tab"
                class={['sort-pill', sortKey === option.key && 'active']}
                aria-selected={sortKey === option.key}
                onclick={() => (sortKey = option.key)}
              >
                {option.label}
              </button>
            {/each}
          </div>
        </div>

        <ul class="catalog-list">
          {#each catalogRows as row (row.item.exercise)}
            <li>
              <button
                type="button"
                class={['catalog-item', selectedExercise === row.item.exercise && 'active']}
                style:--ex-color={row.color}
                onclick={() => selectExercise(row.item.exercise)}
              >
                <span class="cat-main">
                  <strong>{row.item.exercise}</strong>
                  <span class="cat-meta">
                    {row.item.sessions} сессий ·
                    {row.item.periodEnd ? formatDateRu(row.item.periodEnd) : '—'}
                  </span>
                </span>
                {#if row.sparkPath}
                  <svg class="cat-spark" viewBox="0 0 52 18" aria-hidden="true">
                    <path d={row.sparkPath} fill="none" stroke="var(--ex-color)" stroke-width="1.8" />
                  </svg>
                {/if}
                <span class="cat-1rm">{fmtNum(row.item.best1rm.value)}<small>кг</small></span>
              </button>
            </li>
          {/each}
        </ul>
      </aside>

      <main class="detail card">
        {#if selectedExercise && selectedSummary}
          <header class="detail-head">
            <div>
              <div class="eyebrow">Выбрано упражнение</div>
              <h2>{selectedExercise}</h2>
              {#if displayDelta != null}
                <p
                  class={[
                    'trend-badge',
                    displayDelta > 0 && 'up',
                    displayDelta < 0 && 'down'
                  ]}
                >
                  {displayDelta > 0 ? '+' : ''}{fmtNum(displayDelta)}%
                  {usingPeriod ? ' за выбранный период' : ' за всё время'}
                </p>
              {/if}
            </div>
            <div class="detail-actions">
              <a
                class="button button-secondary"
                href="{base}/history?exercise={encodeURIComponent(selectedExercise)}"
              >
                История
              </a>
              <button class="button button-ghost" type="button" onclick={clearSelection}>
                Закрыть
              </button>
            </div>
          </header>

          <div class="period-controls" role="toolbar" aria-label="Период анализа">
            {#each PERIOD_PRESETS as preset (preset.key)}
              <button
                type="button"
                class={['period-pill', periodPreset === preset.key && 'active']}
                onclick={() => applyPeriodPreset(preset.key)}
              >
                {preset.label}
              </button>
            {/each}
            {#if periodPreset === 'custom'}
              <span class="period-custom-label">Свой период</span>
            {/if}
            {#if periodRange}
              <button type="button" class="period-reset" onclick={resetPeriod}>Сброс</button>
            {/if}
          </div>

          <div class="kpi-grid">
            <article>
              <span>Лучший 1ПМ{usingPeriod ? ' · период' : ''}</span>
              <strong>
                {fmtNum(usingPeriod ? periodSummary!.best1rm.value : selectedSummary.best1rm.value)}<em
                  >кг</em
                >
              </strong>
              <small>
                {usingPeriod
                  ? formatDateRu(periodSummary!.best1rm.date)
                  : selectedSummary.best1rm.date
                    ? formatDateRu(selectedSummary.best1rm.date)
                    : '—'}
              </small>
            </article>
            <article>
              <span>Лучший подход{usingPeriod ? ' · период' : ''}</span>
              <strong>
                {usingPeriod
                  ? fmtSet(periodSummary!.bestSet.weight, periodSummary!.bestSet.reps)
                  : fmtSet(selectedSummary.bestWeight.weight, selectedSummary.bestWeight.reps)}
              </strong>
              <small>
                {usingPeriod
                  ? formatDateRu(periodSummary!.bestSet.date)
                  : selectedSummary.bestWeight.date
                    ? formatDateRu(selectedSummary.bestWeight.date)
                    : '—'}
              </small>
            </article>
            <article>
              <span>Сессий{usingPeriod ? ' · период' : ''}</span>
              <strong>{usingPeriod ? periodSummary!.sessions : selectedSummary.sessions}</strong>
              <small>{usingPeriod ? periodSets : selectedSummary.sets} подходов</small>
            </article>
            <article>
              <span>Средняя интенсивность{usingPeriod ? ' · период' : ''}</span>
              <strong>
                {fmtNum(usingPeriod ? periodSummary!.avgIntensity : selectedSummary.avgIntensity)}<em
                  >кг</em
                >
              </strong>
              <small>
                {#if usingPeriod}
                  {formatDateRu(periodSummary!.from)} — {formatDateRu(periodSummary!.to)}
                {:else}
                  на повторение
                {/if}
              </small>
            </article>
          </div>

          <div class="chart-wrap">
            <TrendChart
              title="Расчётный 1ПМ"
              points={trendPoints}
              color={chartColor}
              range={periodRange}
              enableRangeSelect={true}
              onRangeChange={setPeriodRange}
            />
          </div>
        {:else}
          <header class="detail-head overview-head">
            <div>
              <div class="eyebrow">Обзор</div>
              <h2>Выберите упражнение</h2>
              <p>Кликните в списке слева — откроется график и детальная сводка.</p>
            </div>
          </header>

          {#if insights.length > 0}
            <ul class="insight-list">
              {#each insights as item (item.id)}
                <li class="insight insight-{item.tone}">
                  <span class="insight-dot"></span>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}

          <div class="rank-grid">
            <section class="rank-panel">
              <div class="rank-head">
                <span class="eyebrow">По 1ПМ</span>
                <h3>Самые сильные</h3>
              </div>
              <ul class="rank-list">
                {#each strongest as item, index (item.exercise)}
                  {@render rankRow(item, index, '1rm', max1rm)}
                {/each}
              </ul>
            </section>

            <section class="rank-panel">
              <div class="rank-head">
                <span class="eyebrow">По сессиям</span>
                <h3>Основа программы</h3>
              </div>
              <ul class="rank-list">
                {#each mostPracticed as item, index (item.exercise)}
                  {@render rankRow(item, index, 'sessions', maxSessions)}
                {/each}
              </ul>
            </section>
          </div>
        {/if}
      </main>
    </div>
  {/if}
</div>

<style>
  .analytics {
    padding-bottom: 40px;
  }

  .header-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .recent-prs {
    margin-bottom: 14px;
    padding: 16px 18px;
  }

  .recent-prs-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .recent-prs-head h2 {
    margin: 4px 0 0;
    font-size: 16px;
    letter-spacing: 0.03em;
  }

  .recent-prs-count {
    display: grid;
    place-items: center;
    min-width: 34px;
    height: 34px;
    padding: 0 8px;
    color: var(--accent);
    background: rgb(204 255 51 / 10%);
    border: 1px solid rgb(204 255 51 / 35%);
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 800;
  }

  .recent-prs-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 8px;
  }

  .recent-pr-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: auto auto;
    gap: 2px 10px;
    width: 100%;
    padding: 10px 12px;
    color: var(--text);
    background: #0e1014;
    border: 1px solid var(--line);
    border-left: 3px solid var(--ex-color, var(--accent));
    cursor: pointer;
    text-align: left;
    transition:
      background 120ms ease,
      border-color 120ms ease;
  }

  .recent-pr-item:hover {
    background: rgb(255 255 255 / 2%);
    border-color: color-mix(in srgb, var(--ex-color, var(--accent)) 35%, var(--line));
  }

  .recent-pr-item.active {
    background: color-mix(in srgb, var(--ex-color, var(--accent)) 10%, #121419);
    border-color: color-mix(in srgb, var(--ex-color, var(--accent)) 45%, var(--line));
  }

  .recent-pr-name {
    grid-column: 1;
    grid-row: 1;
    font-size: 12px;
    font-weight: 700;
    line-height: 1.25;
  }

  .recent-pr-value {
    grid-column: 2;
    grid-row: 1 / span 2;
    align-self: center;
    color: var(--ex-color, var(--accent));
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 800;
    white-space: nowrap;
  }

  .recent-pr-value small {
    margin-left: 2px;
    color: var(--muted);
    font-size: 9px;
    font-weight: 600;
  }

  .recent-pr-date {
    grid-column: 1;
    grid-row: 2;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 9px;
  }

  .analytics-workspace {
    display: grid;
    grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
    gap: 12px;
    align-items: stretch;
  }

  .catalog {
    display: flex;
    flex-direction: column;
    min-height: 420px;
    height: 100%;
    padding: 0;
    overflow: hidden;
  }

  .catalog-head {
    display: grid;
    gap: 10px;
    padding: 18px 18px 14px;
    border-bottom: 1px solid var(--line);
  }

  .catalog-head h2 {
    margin: 0;
    font-size: 18px;
    letter-spacing: 0.03em;
  }

  .catalog-head p {
    margin: 3px 0 0;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .search {
    width: 100%;
  }

  .sort-row {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .sort-pill {
    padding: 5px 9px;
    color: var(--muted-strong);
    background: #0a0c10;
    border: 1px solid var(--line);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    transition:
      border-color 120ms ease,
      color 120ms ease;
  }

  .sort-pill.active {
    color: var(--accent-ink);
    background: var(--accent);
    border-color: var(--accent);
  }

  .catalog-list {
    list-style: none;
    margin: 0;
    padding: 6px;
    overflow: auto;
    flex: 1;
  }

  .catalog-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 10px;
    align-items: center;
    width: 100%;
    padding: 10px 12px;
    color: var(--text);
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    text-align: left;
    transition:
      background 120ms ease,
      border-color 120ms ease;
  }

  .catalog-item:hover {
    background: rgb(255 255 255 / 2%);
    border-color: var(--line);
  }

  .catalog-item.active {
    background: color-mix(in srgb, var(--ex-color) 10%, #121419);
    border-color: color-mix(in srgb, var(--ex-color) 35%, var(--line));
    border-left: 3px solid var(--ex-color);
  }

  .cat-main strong {
    display: block;
    font-size: 12px;
    font-weight: 700;
    line-height: 1.25;
  }

  .cat-meta {
    display: block;
    margin-top: 3px;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 9px;
  }

  .cat-spark {
    width: 52px;
    height: 18px;
    opacity: 0.85;
  }

  .cat-1rm {
    color: var(--ex-color, var(--accent));
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 800;
    white-space: nowrap;
  }

  .cat-1rm small {
    margin-left: 2px;
    color: var(--muted);
    font-size: 9px;
    font-weight: 600;
  }

  .detail {
    display: flex;
    flex-direction: column;
    padding: 22px;
    min-height: 420px;
    height: 100%;
  }

  .detail-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 20px;
  }

  .detail-head h2 {
    margin: 4px 0 0;
    font-size: clamp(22px, 3vw, 30px);
    letter-spacing: 0.02em;
  }

  .detail-head p,
  .overview-head p {
    margin: 6px 0 0;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.45;
  }

  .trend-badge {
    display: inline-block;
    margin-top: 8px;
    padding: 4px 9px;
    color: var(--muted-strong);
    background: #0a0c10;
    border: 1px solid var(--line);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
  }

  .trend-badge.up {
    color: var(--accent);
    border-color: rgb(204 255 51 / 35%);
  }

  .trend-badge.down {
    color: var(--danger);
    border-color: rgb(255 92 82 / 35%);
  }

  .detail-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .period-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-bottom: 14px;
  }

  .period-pill {
    padding: 5px 10px;
    color: var(--muted-strong);
    background: #0a0c10;
    border: 1px solid var(--line);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    transition:
      border-color 120ms ease,
      color 120ms ease,
      background 120ms ease;
  }

  .period-pill.active {
    color: var(--accent-ink);
    background: var(--accent);
    border-color: var(--accent);
  }

  .period-custom-label {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .period-reset {
    padding: 5px 10px;
    color: var(--muted-strong);
    background: transparent;
    border: 1px dashed var(--line);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 18px;
  }

  .kpi-grid article {
    padding: 14px;
    background: #0e1014;
    border: 1px solid var(--line);
  }

  .kpi-grid span {
    display: block;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }

  .kpi-grid strong {
    display: block;
    margin-top: 8px;
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 800;
    line-height: 1;
  }

  .kpi-grid strong em {
    margin-left: 3px;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10px;
    font-style: normal;
    font-weight: 600;
  }

  .kpi-grid small {
    display: block;
    margin-top: 6px;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 9px;
  }

  .chart-wrap {
    flex: 1;
    min-height: 0;
  }

  .chart-wrap :global(.chart-card) {
    padding: 0;
    border: 0;
    background: transparent;
  }

  .insight-list {
    list-style: none;
    margin: 0 0 18px;
    padding: 0;
    display: grid;
    gap: 8px;
  }

  .insight {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 12px;
    align-items: start;
    padding: 12px 14px;
    background: #0e1014;
    border: 1px solid var(--line);
  }

  .insight-dot {
    width: 8px;
    height: 8px;
    margin-top: 5px;
    background: var(--muted);
  }

  .insight-good .insight-dot {
    background: var(--accent);
    box-shadow: 0 0 12px rgb(204 255 51 / 45%);
  }

  .insight-warn .insight-dot {
    background: var(--hazard);
  }

  .insight strong {
    display: block;
    font-size: 12px;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .insight p {
    margin: 4px 0 0;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.45;
  }

  .rank-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .rank-panel {
    padding: 16px;
    background: #0e1014;
    border: 1px solid var(--line);
  }

  .rank-head h3 {
    margin: 4px 0 0;
    font-size: 16px;
    letter-spacing: 0.03em;
  }

  .rank-list {
    list-style: none;
    margin: 14px 0 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }

  .rank-list button {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    width: 100%;
    padding: 8px 0;
    color: var(--text);
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--line);
    cursor: pointer;
    text-align: left;
  }

  .rank-list li:last-child button {
    border-bottom: 0;
  }

  .rank-no {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 800;
  }

  .rank-body {
    position: relative;
    min-width: 0;
    padding-bottom: 6px;
  }

  .rank-body strong {
    display: block;
    overflow: hidden;
    font-size: 11px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rank-bar {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 2px;
    background: linear-gradient(90deg, var(--accent), transparent);
    max-width: 100%;
  }

  .rank-bar.sessions {
    background: linear-gradient(90deg, var(--blue), transparent);
  }

  .rank-list em {
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: 11px;
    font-style: normal;
    font-weight: 800;
  }

  .skeleton-panel {
    padding: 20px;
    display: grid;
    gap: 12px;
  }

  .skeleton {
    display: block;
    border-radius: 0;
    background: linear-gradient(
      90deg,
      rgb(255 255 255 / 4%) 0%,
      rgb(255 255 255 / 9%) 50%,
      rgb(255 255 255 / 4%) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.2s ease-in-out infinite;
  }

  @keyframes shimmer {
    0% {
      background-position: 100% 0;
    }
    100% {
      background-position: -100% 0;
    }
  }

  .workspace-skeleton {
    height: 420px;
  }

  @media (max-width: 980px) {
    .analytics-workspace {
      grid-template-columns: 1fr;
    }

    .catalog {
      position: static;
      max-height: none;
      min-height: 0;
    }

    .catalog-list {
      max-height: 320px;
    }

    .kpi-grid {
      grid-template-columns: 1fr 1fr;
    }
  }

  @media (max-width: 620px) {
    .recent-prs-list {
      grid-template-columns: 1fr;
    }

    .detail-head {
      flex-direction: column;
    }

    .detail-actions {
      width: 100%;
    }

    .detail-actions .button {
      flex: 1;
    }

    .rank-grid {
      grid-template-columns: 1fr;
    }

    .kpi-grid {
      grid-template-columns: 1fr;
    }

    .header-actions {
      width: 100%;
    }

    .header-actions .button {
      flex: 1;
    }
  }
</style>
