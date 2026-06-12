<script lang="ts">
  import { base } from '$app/paths';
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import {
    defaultActiveMesoMicro,
    exerciseTargetOnMicro,
    exercisesForMicroSession,
    resolveMesoMicroSelection,
    suggestSessionIndex
  } from '$lib/cycle-plan';
  import { createLog } from '$lib/database';
  import { mesoProtocolId } from '$lib/exercise-keys';
  import { formatDateRu, fmtNum, todayIso } from '$lib/format';
  import { microHasDate } from '$lib/micro-plan';
  import {
    indexToSlot,
    mesocycleColor,
    slotColor,
    slotLabel,
    slotToIndex,
    type WorkoutSlot
  } from '$lib/microcycle';
  import {
    formatPlannedSets,
    protocolGuideWeek,
    suggestPlannedSets,
    type PlannedSetsInput
  } from '$lib/planned-sets';
  import { thesesStore } from '$lib/training-theses';
  import type { ExerciseKind, ExerciseSet } from '$lib/types';
  import { TRAINING_VOLUME_GUIDE_ID } from '$lib/volume-guide';
  import { deleteSession, saveLog, workoutStore } from '$lib/workout-store';

  let datePick = $state(todayIso());
  let mesoPick = $state<string | null>(null);
  let microPick = $state<string | null>(null);
  let slotPick = $state<WorkoutSlot | null>(null);
  let busyId = $state<string | null>(null);
  let error = $state('');

  const urlDate = $derived.by(() => (browser ? page.url.searchParams.get('date') : null));
  const urlMeso = $derived.by(() => (browser ? page.url.searchParams.get('meso') : null));
  const urlMicro = $derived.by(() => (browser ? page.url.searchParams.get('micro') : null));
  const selectedDate = $derived(urlDate ?? datePick);
  const view = $derived(workoutStore.view);
  const mesocycles = $derived(view.cyclePlanView.mesocycles);

  const trainingContext = $derived.by(() => {
    const resolved = resolveMesoMicroSelection(
      mesocycles,
      selectedDate,
      mesoPick ?? urlMeso,
      microPick ?? urlMicro
    );
    if (resolved) return resolved;
    const hasExplicitPick = Boolean(mesoPick ?? urlMeso ?? microPick ?? urlMicro);
    if (!hasExplicitPick && selectedDate === todayIso()) return defaultActiveMesoMicro(mesocycles);
    return null;
  });

  const mesocycle = $derived(trainingContext?.meso ?? null);
  const microcycle = $derived(trainingContext?.micro ?? null);
  const suggestedIndex = $derived.by(() =>
    microcycle ? suggestSessionIndex(microcycle, selectedDate, view.entries, view.workoutTemplates) : 0
  );
  const activeIndex = $derived(slotPick != null ? slotToIndex(slotPick) : suggestedIndex);
  const activeSlot = $derived(indexToSlot(activeIndex));
  const slotExercises = $derived.by(() =>
    mesocycle ? exercisesForMicroSession(mesocycle, view.workoutTemplates, activeIndex) : []
  );
  const entriesForDate = $derived(
    view.entries
      .filter((entry) => entry.date === selectedDate)
      .sort((a, b) => a.exercise.localeCompare(b.exercise, 'ru'))
  );
  const entryByExercise = $derived(new Map(entriesForDate.map((entry) => [entry.exercise, entry])));
  const loggedPlanned = $derived(slotExercises.filter((exercise) => entryByExercise.has(exercise)).length);
  const sessionProgress = $derived(
    slotExercises.length ? Math.round((loggedPlanned / slotExercises.length) * 100) : 0
  );
  const availableDates = $derived([...new Set(view.entries.map((entry) => entry.date))].sort().reverse());
  const lastTrainingDate = $derived(availableDates.find((date) => date < selectedDate) ?? null);
  const totalTrainingDays = $derived(new Set(view.entries.map((entry) => entry.date)).size);

  const protocolHints = $derived.by(() => {
    if (!mesocycle || !microcycle) {
      return new Map<string, NonNullable<ReturnType<typeof exerciseTargetOnMicro>>>();
    }
    const hints = new Map<string, NonNullable<ReturnType<typeof exerciseTargetOnMicro>>>();
    for (const exercise of slotExercises) {
      const anchor = mesocycle.anchorInfo[exercise]?.anchor;
      if (!anchor) continue;
      const row = exerciseTargetOnMicro(
        view.cyclePlanForCalc,
        mesocycle.plan,
        microcycle.plan,
        exercise,
        anchor,
        view.keyMaps,
        entryByExercise.get(exercise)
      );
      if (row) hints.set(exercise, row);
    }
    return hints;
  });

  const volumeGuideRows = $derived(
    thesesStore.volumeGuides.find((guide) => guide.id === TRAINING_VOLUME_GUIDE_ID)?.rows ?? []
  );
  const outOfPlanEntries = $derived(
    entriesForDate.filter((entry) => !slotExercises.includes(entry.exercise))
  );

  function exerciseKind(name: string): ExerciseKind {
    return workoutStore.database.exercises.find((item) => item.name === name)?.kind ?? 'strength';
  }

  function plannedInput(exerciseName: string): PlannedSetsInput | null {
    if (!mesocycle || !microcycle) return null;
    const protocolId =
      mesoProtocolId(mesocycle.plan, exerciseName, view.keyMaps) ?? mesocycle.plan.templateId;
    const guide = thesesStore.protocolGuideFor(protocolId);
    return {
      exercise: exerciseName,
      kind: exerciseKind(exerciseName),
      date: selectedDate,
      entries: view.entries,
      anchor1rm: mesocycle.anchorInfo[exerciseName]?.anchor ?? null,
      cyclePlan: view.cyclePlanForCalc,
      meso: mesocycle.plan,
      micro: microcycle.plan,
      keyMaps: view.keyMaps,
      protocolGuideWeek: protocolGuideWeek(guide?.weeks, microcycle.plan.indexInMeso),
      volumeGuideRows
    };
  }

  function plannedPreview(exerciseName: string): string | null {
    const input = plannedInput(exerciseName);
    if (!input) return null;
    return formatPlannedSets(suggestPlannedSets(input), input.kind);
  }

  function addUrl(exercise: string, entryId?: string): string {
    const params = new URLSearchParams();
    if (entryId) params.set('id', entryId);
    else params.set('exercise', exercise);
    params.set('date', selectedDate);
    if (mesocycle) params.set('meso', mesocycle.plan.id);
    if (microcycle) params.set('micro', microcycle.plan.id);
    params.set('session', String(activeIndex));
    return `${base}/add?${params.toString()}`;
  }

  function setLabel(kind: ExerciseKind, set: ExerciseSet): string {
    const [first, second] = set;
    if (kind === 'run') return `${first} мин · ${second} км/ч`;
    if (kind === 'jumps') return `${first} подх. × ${second}`;
    return `${first} кг × ${second}`;
  }

  async function confirmPlanned(exerciseName: string) {
    const input = plannedInput(exerciseName);
    if (!input || !mesocycle || !microcycle) return;
    busyId = exerciseName;
    error = '';
    try {
      const sets = suggestPlannedSets(input);
      const { db, log } = createLog(
        workoutStore.database,
        exerciseName,
        selectedDate,
        [{ kind: input.kind, sets, comment: null }],
        crypto.randomUUID()
      );
      workoutStore.database = db;
      await saveLog(log, {
        mesoId: mesocycle.plan.id,
        microId: microcycle.plan.id,
        indexInMicro: activeIndex
      });
    } catch (err) {
      error = err instanceof Error ? err.message : 'Не удалось сохранить';
    } finally {
      busyId = null;
    }
  }

  async function removeEntry(id: string | undefined) {
    if (!id) return;
    busyId = id;
    error = '';
    try {
      await deleteSession(id);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Не удалось удалить запись';
    } finally {
      busyId = null;
    }
  }
</script>

<div class="container dashboard">
  <header class="page-header">
    <div>
      <div class="eyebrow">Рабочий день</div>
      <h1>{selectedDate === todayIso() ? 'Тренировка сегодня' : formatDateRu(selectedDate)}</h1>
      <p>
        План, целевые веса и фактические подходы собраны в одном месте. Меняй дату, если нужно
        подготовить тренировку заранее или восстановить запись.
      </p>
    </div>
    <div class="date-control">
      <span>Дата тренировки</span>
      <input
        type="date"
        value={selectedDate}
        oninput={(event) => (datePick = event.currentTarget.value)}
        list="workout-dates"
      />
      <datalist id="workout-dates">
        {#each availableDates as date (date)}
          <option value={date}></option>
        {/each}
      </datalist>
    </div>
  </header>

  <section class="metric-grid overview-metrics">
    <article class="metric-card">
      <span>План на тренировку</span>
      <strong>{slotExercises.length}</strong>
      <small>упражнений в сессии {activeSlot}</small>
    </article>
    <article class="metric-card">
      <span>Готовность сессии</span>
      <strong>{sessionProgress}%</strong>
      <small>{loggedPlanned} из {slotExercises.length} записано</small>
    </article>
    <article class="metric-card">
      <span>Всего тренировок</span>
      <strong>{totalTrainingDays}</strong>
      <small>дней в журнале</small>
    </article>
    <article class="metric-card">
      <span>Предыдущая тренировка</span>
      <strong class="date-value">{lastTrainingDate ? formatDateRu(lastTrainingDate) : '—'}</strong>
      <small>{lastTrainingDate ? 'последняя запись до этой даты' : 'история пока пуста'}</small>
    </article>
  </section>

  {#if mesocycles.length === 0}
    <section class="card empty-state onboarding">
      <div class="eyebrow">Первый шаг</div>
      <h2>Соберите первый тренировочный цикл</h2>
      <p>
        Задайте блоки макроцикла, протоколы и упражнения. После этого здесь появится готовый план
        каждой тренировки.
      </p>
      <a class="button button-primary" href="{base}/cycles">Создать макроцикл</a>
    </section>
  {:else}
    <section class="card training-card">
      <div class="training-top">
        <div>
          <div class="eyebrow">Контекст тренировки</div>
          <h2>{mesocycle?.plan.label ?? 'Выберите мезоцикл'}</h2>
          {#if mesocycle && microcycle}
            <p>
              Микроцикл {microcycle.plan.indexInMeso} · сессия {activeSlot} ·
              {formatDateRu(mesocycle.plan.startDate)} — {formatDateRu(mesocycle.plan.endDate)}
            </p>
          {/if}
        </div>
        <div class="session-ring" style={`--progress: ${sessionProgress * 3.6}deg`}>
          <span>{sessionProgress}%</span>
        </div>
      </div>

      <div class="context-picker">
        <div>
          <span class="control-label">Мезоцикл</span>
          <div class="choice-row">
            {#each mesocycles as meso (meso.plan.id)}
              <button
                type="button"
                class="choice"
                class:active={mesocycle?.plan.id === meso.plan.id}
                style={`--choice-color: ${mesocycleColor(meso.index)}`}
                onclick={() => {
                  mesoPick = meso.plan.id;
                  microPick =
                    meso.microcycles.find((micro) => microHasDate(micro.plan, selectedDate))?.plan.id ??
                    meso.microcycles.find((micro) => !micro.complete)?.plan.id ??
                    meso.microcycles[0]?.plan.id ??
                    null;
                  slotPick = null;
                }}
              >
                <b>{meso.index}</b>
                <span>{meso.plan.label}</span>
              </button>
            {/each}
          </div>
        </div>

        {#if mesocycle}
          <div>
            <span class="control-label">Микроцикл</span>
            <div class="choice-row compact">
              {#each mesocycle.microcycles as micro (micro.plan.id)}
                <button
                  type="button"
                  class="micro-choice"
                  class:active={microcycle?.plan.id === micro.plan.id}
                  class:complete={micro.complete}
                  onclick={() => {
                    microPick = micro.plan.id;
                    slotPick = null;
                  }}
                >
                  {micro.plan.indexInMeso}
                  <small>{micro.complete ? 'готов' : 'в работе'}</small>
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <div>
          <span class="control-label">Сессия</span>
          <div class="choice-row compact">
            {#each ['A', 'B'] as slot (slot)}
              {@const slotKey = slot as WorkoutSlot}
              <button
                type="button"
                class="slot-choice"
                class:active={activeSlot === slotKey}
                style={`--choice-color: ${slotColor(slotKey)}`}
                onclick={() => (slotPick = slotKey)}
              >
                <b>{slot}</b>
                <span>{slotLabel(slotKey)}</span>
              </button>
            {/each}
          </div>
        </div>
      </div>
    </section>

    <div class="section-heading">
      <div>
        <h2>План сессии {activeSlot}</h2>
        <p>Готово — по плану. Изменить — если нужно подправить.</p>
      </div>
      <a class="button button-secondary" href="{base}/add?date={selectedDate}&session={activeIndex}">
        Добавить вне плана
      </a>
    </div>

    {#if mesocycle && microcycle && slotExercises.length > 0}
      <section class="exercise-grid">
        {#each slotExercises as exercise, index (exercise)}
          {@const entry = entryByExercise.get(exercise)}
          {@const hint = protocolHints.get(exercise)}
          {@const preview = entry ? null : plannedPreview(exercise)}
          <article class="exercise-item" class:complete={Boolean(entry)}>
            <div class="exercise-index">{entry ? '✓' : index + 1}</div>
            <div class="exercise-content">
              <div class="exercise-heading">
                <div>
                  <h3>{exercise}</h3>
                  {#if entry}
                    <div class="set-list compact">
                      {#each entry.sets as set}
                        <span>{setLabel(entry.kind, set)}</span>
                      {/each}
                    </div>
                  {:else if hint || preview}
                    <p class="plan-line">
                      {#if hint}
                        {fmtNum(hint.targetWeight)} кг · {hint.targetPct}%
                      {/if}
                      {#if preview}
                        {#if hint} · {/if}{preview}
                      {/if}
                    </p>
                  {/if}
                </div>
                <div class="exercise-actions">
                  {#if entry}
                    <a class="button button-secondary" href={addUrl(exercise, entry?.id)}>Изменить</a>
                    {#if entry.id}
                      <button
                        type="button"
                        class="text-button danger"
                        disabled={busyId === entry.id}
                        onclick={() => removeEntry(entry.id)}
                      >
                        {busyId === entry.id ? '…' : 'Удалить'}
                      </button>
                    {/if}
                  {:else}
                    <button
                      type="button"
                      class="button button-primary"
                      disabled={busyId === exercise}
                      onclick={() => confirmPlanned(exercise)}
                    >
                      {busyId === exercise ? 'Сохраняем…' : 'Готово'}
                    </button>
                    <a class="button button-secondary" href={addUrl(exercise)}>Изменить</a>
                  {/if}
                </div>
              </div>
            </div>
          </article>
        {/each}
      </section>
    {:else}
      <section class="card empty-state">
        <h2>Для этой сессии нет упражнений</h2>
        <p>Добавьте упражнения в мезоцикл или выберите другую сессию.</p>
        <a class="button button-secondary" href="{base}/cycles">Открыть план</a>
      </section>
    {/if}
  {/if}

  {#if outOfPlanEntries.length > 0}
    <div class="section-heading">
      <div>
        <h2>Вне плана</h2>
        <p>Записи, не входящие в текущую сессию</p>
      </div>
    </div>
    <section class="day-log card">
      {#each outOfPlanEntries as entry (entry.id ?? `${entry.exercise}-${entry.date}`)}
        <article>
          <div>
            <strong>{entry.exercise}</strong>
            <div class="inline-sets">
              {#each entry.sets as set}
                <span>{setLabel(entry.kind, set)}</span>
              {/each}
            </div>
          </div>
          <div class="log-actions">
            {#if entry.id}
              <a href={addUrl(entry.exercise, entry.id)}>Изменить</a>
              <button type="button" disabled={busyId === entry.id} onclick={() => removeEntry(entry.id)}>
                {busyId === entry.id ? 'Удаление...' : 'Удалить'}
              </button>
            {/if}
          </div>
        </article>
      {/each}
    </section>
  {/if}

  {#if error}
    <section class="error-banner">{error}</section>
  {/if}
</div>

<style>
  .dashboard {
    padding-bottom: 30px;
  }

  .date-control {
    width: 176px;
  }

  .date-control span,
  .control-label {
    display: block;
    margin-bottom: 7px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 750;
  }

  .overview-metrics {
    margin-bottom: 16px;
  }

  .date-value {
    font-size: 17px;
    line-height: 1.15;
  }

  .onboarding {
    margin-top: 24px;
  }

  .training-card {
    padding: 24px;
  }

  .training-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding-bottom: 22px;
    border-bottom: 1px solid var(--line);
  }

  .training-top h2 {
    margin: 6px 0 6px;
    font-size: 27px;
  }

  .training-top p {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
  }

  .session-ring {
    display: grid;
    width: 68px;
    height: 68px;
    flex: 0 0 auto;
    place-items: center;
    background:
      radial-gradient(circle closest-side, #151b27 78%, transparent 80% 100%),
      conic-gradient(var(--accent) var(--progress), #2a3242 0);
    border-radius: 50%;
  }

  .session-ring span {
    font-size: 12px;
    font-weight: 850;
  }

  .context-picker {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) minmax(180px, 0.7fr);
    gap: 22px;
    padding-top: 22px;
  }

  .choice-row {
    display: flex;
    gap: 7px;
    overflow-x: auto;
    padding-bottom: 2px;
  }

  .choice,
  .micro-choice,
  .slot-choice {
    color: var(--muted-strong);
    background: #0d121b;
    border: 1px solid var(--line);
    border-radius: 0;
    cursor: pointer;
  }

  .choice {
    min-width: 132px;
    padding: 9px 11px;
    text-align: left;
  }

  .choice b,
  .choice span {
    display: block;
  }

  .choice b {
    color: var(--choice-color);
    font-size: 10px;
  }

  .choice span {
    margin-top: 3px;
    overflow: hidden;
    font-size: 11px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .choice.active,
  .slot-choice.active {
    color: var(--text);
    background: color-mix(in srgb, var(--choice-color) 10%, #111722);
    border-color: color-mix(in srgb, var(--choice-color) 40%, var(--line));
  }

  .micro-choice {
    min-width: 58px;
    padding: 8px;
    font-size: 14px;
    font-weight: 850;
  }

  .micro-choice small {
    display: block;
    margin-top: 2px;
    color: var(--muted);
    font-size: 8px;
    font-weight: 650;
  }

  .micro-choice.active {
    color: var(--accent);
    background: rgb(185 243 90 / 8%);
    border-color: rgb(185 243 90 / 36%);
  }

  .micro-choice.complete small {
    color: var(--accent);
  }

  .slot-choice {
    display: flex;
    min-width: 94px;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
  }

  .slot-choice b {
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    color: #0b1016;
    background: var(--choice-color);
    border-radius: 0;
  }

  .slot-choice span {
    font-size: 10px;
    font-weight: 700;
  }

  .exercise-grid {
    display: grid;
    gap: 10px;
  }

  .exercise-item {
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr);
    gap: 14px;
    padding: 18px;
    background: linear-gradient(145deg, #131925, #0e131d);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }

  .exercise-item.complete {
    border-color: rgb(185 243 90 / 22%);
  }

  .exercise-index {
    display: grid;
    width: 34px;
    height: 34px;
    place-items: center;
    color: var(--muted);
    background: #0a0e16;
    border: 1px solid var(--line);
    border-radius: 0;
    font-size: 12px;
    font-weight: 850;
  }

  .exercise-item.complete .exercise-index {
    color: var(--accent-ink);
    background: var(--accent);
    border-color: var(--accent);
  }

  .exercise-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  .exercise-heading h3 {
    margin: 1px 0 4px;
    font-size: 16px;
  }

  .exercise-heading p {
    margin: 0;
    color: var(--muted);
    font-size: 11px;
  }

  .plan-line {
    margin-top: 6px !important;
    color: var(--muted-strong) !important;
    font-size: 12px !important;
  }

  .exercise-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: flex-end;
  }

  .text-button {
    padding: 0;
    color: var(--danger);
    background: transparent;
    border: 0;
    cursor: pointer;
    font-size: 10px;
  }

  .set-list.compact {
    margin-top: 8px;
  }

  .set-list.compact span {
    padding: 4px 7px;
    font-size: 10px;
  }

  .set-list,
  .inline-sets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .set-list {
    margin-top: 14px;
  }

  .set-list span,
  .inline-sets span {
    padding: 6px 9px;
    color: var(--muted-strong);
    background: #0a0f17;
    border: 1px solid var(--line);
    border-radius: 0;
    font-size: 11px;
    font-weight: 700;
  }

  .day-log {
    padding: 4px 18px;
  }

  .day-log article {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    padding: 14px 0;
    border-bottom: 1px solid var(--line);
  }

  .day-log article:last-child {
    border-bottom: 0;
  }

  .day-log strong {
    display: block;
    margin-bottom: 7px;
    font-size: 13px;
  }

  .inline-sets span {
    padding: 3px 6px;
    font-size: 9px;
  }

  .log-actions {
    display: flex;
    gap: 10px;
    font-size: 10px;
  }

  .log-actions a {
    color: var(--blue);
  }

  .log-actions button {
    padding: 0;
    color: var(--danger);
    background: transparent;
    border: 0;
    cursor: pointer;
  }

  .error-banner {
    margin-top: 14px;
    padding: 13px 16px;
    color: #ffd3d3;
    background: rgb(255 114 114 / 10%);
    border: 1px solid rgb(255 114 114 / 24%);
    border-radius: 0;
  }

  @media (max-width: 1050px) {
    .context-picker {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 680px) {
    .date-control {
      width: 100%;
    }

    .training-card {
      padding: 18px;
    }

    .exercise-item {
      grid-template-columns: 30px minmax(0, 1fr);
      gap: 10px;
      padding: 14px;
    }

    .exercise-index {
      width: 30px;
      height: 30px;
    }

    .exercise-heading {
      align-items: stretch;
      flex-direction: column;
    }

    .exercise-heading .button {
      width: 100%;
    }

    .day-log article {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
