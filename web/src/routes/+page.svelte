<script lang="ts">
  import { base } from '$app/paths';
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import {
    exerciseTargetOnMicro,
    exercisesForMicroSession,
    sortExercisesByAnchorDesc,
    type EnrichedMicrocycle
  } from '$lib/cycle-plan';
  import { createLog } from '$lib/database';
  import { mesoProtocolId } from '$lib/exercise-keys';
  import { formatDateRu, fmtNum, todayIso } from '$lib/format';
  import {
    indexToSlot,
    mesocycleColor,
    slotColor,
    slotLabel,
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
  const urlSession = $derived.by(() => {
    const raw = browser ? page.url.searchParams.get('session') : null;
    if (raw === '0') return 0 as const;
    if (raw === '1') return 1 as const;
    return null;
  });
  const view = $derived(workoutStore.view);
  const mesocycles = $derived(view.cyclePlanView.mesocycles);

  const selectedMesoId = $derived(mesoPick ?? urlMeso);
  const selectedMicroId = $derived(microPick ?? urlMicro);

  const mesocycle = $derived.by(() => {
    if (!selectedMesoId) return null;
    return mesocycles.find((item) => item.plan.id === selectedMesoId) ?? null;
  });

  const microcycle = $derived.by(() => {
    if (!mesocycle || !selectedMicroId) return null;
    return mesocycle.microcycles.find((item) => item.plan.id === selectedMicroId) ?? null;
  });
  const activeIndex = $derived.by((): 0 | 1 | null => {
    if (slotPick != null) return slotPick === 'B' ? 1 : 0;
    return urlSession;
  });
  const sessionReady = $derived(mesocycle != null && microcycle != null && activeIndex != null);
  const activeSlot = $derived(activeIndex != null ? indexToSlot(activeIndex) : null);
  const plannedSessionDate = $derived.by(() => {
    if (!microcycle || activeIndex == null) return null;
    return sessionDateForIndex(microcycle, activeIndex);
  });
  const workoutDate = $derived(
    sessionReady ? (urlDate ?? plannedSessionDate ?? datePick) : (urlDate ?? datePick)
  );
  const slotExercises = $derived.by(() => {
    if (!mesocycle || activeIndex == null) return [];
    return sortExercisesByAnchorDesc(
      exercisesForMicroSession(mesocycle, view.workoutTemplates, activeIndex),
      mesocycle.anchorInfo
    );
  });
  const entriesForDate = $derived(
    view.entries
      .filter((entry) => entry.date === workoutDate)
      .sort((a, b) => a.exercise.localeCompare(b.exercise, 'ru'))
  );
  const entryByExercise = $derived(new Map(entriesForDate.map((entry) => [entry.exercise, entry])));
  const loggedPlanned = $derived(slotExercises.filter((exercise) => entryByExercise.has(exercise)).length);
  const sessionProgress = $derived(
    slotExercises.length ? Math.round((loggedPlanned / slotExercises.length) * 100) : 0
  );
  const availableDates = $derived([...new Set(view.entries.map((entry) => entry.date))].sort().reverse());
  const lastTrainingDate = $derived(availableDates.find((date) => date < workoutDate) ?? null);
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

  function sessionDateForIndex(micro: EnrichedMicrocycle, index: 0 | 1): string | null {
    return index === 0 ? (micro.dayA?.date ?? null) : (micro.dayB?.date ?? null);
  }

  function sessionProgressFor(micro: EnrichedMicrocycle, index: 0 | 1): number {
    if (!mesocycle) return 0;
    const exercises = exercisesForMicroSession(mesocycle, view.workoutTemplates, index);
    if (!exercises.length) return 0;
    const date = sessionDateForIndex(micro, index);
    if (!date) return 0;
    const logged = exercises.filter((exercise) =>
      view.entries.some((entry) => entry.date === date && entry.exercise === exercise)
    ).length;
    return Math.round((logged / exercises.length) * 100);
  }

  function pickSession(slot: WorkoutSlot) {
    slotPick = slot;
    if (!microcycle) return;
    const planned = sessionDateForIndex(microcycle, slot === 'B' ? 1 : 0);
    if (planned) datePick = planned;
  }

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
      date: workoutDate,
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
    params.set('date', workoutDate);
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
    if (!input || !mesocycle || !microcycle || activeIndex == null) return;
    busyId = exerciseName;
    error = '';
    try {
      const sets = suggestPlannedSets(input);
      const { db, log } = createLog(
        workoutStore.database,
        exerciseName,
        workoutDate,
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
      <div class="eyebrow">{sessionReady ? 'Тренировка' : 'Обзор'}</div>
      <h1>
        {#if sessionReady && workoutDate}
          {workoutDate === todayIso() ? 'Тренировка сегодня' : formatDateRu(workoutDate)}
        {:else}
          Выберите тренировку
        {/if}
      </h1>
      <p>
        {#if sessionReady}
          План, целевые веса и факт по выбранной сессии. Меняй дату, если нужно записать тренировку
          в другой день.
        {:else}
          Укажите мезоцикл, микроцикл и сессию A или B — появится план и записи по этому дню.
        {/if}
      </p>
    </div>
    {#if sessionReady}
      <div class="date-control">
        <span>Дата записи</span>
        <input
          type="date"
          value={workoutDate}
          oninput={(event) => (datePick = event.currentTarget.value)}
          list="workout-dates"
        />
        <datalist id="workout-dates">
          {#each availableDates as date (date)}
            <option value={date}></option>
          {/each}
        </datalist>
      </div>
    {/if}
  </header>

  {#if sessionReady}
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
  {/if}

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
          {#if sessionReady && mesocycle && microcycle && activeSlot}
            <p>
              Микроцикл {microcycle.plan.indexInMeso} · сессия {activeSlot}
              {#if plannedSessionDate}
                · {formatDateRu(plannedSessionDate)}
              {:else}
                · дата не назначена
              {/if}
            </p>
          {:else if mesocycle && microcycle}
            <p>Микроцикл {microcycle.plan.indexInMeso} — выберите сессию A или B</p>
          {:else if mesocycle}
            <p>Выберите микроцикл, затем сессию A или B</p>
          {/if}
        </div>
        {#if sessionReady}
          <div class="session-ring" style={`--progress: ${sessionProgress * 3.6}deg`}>
            <span>{sessionProgress}%</span>
          </div>
        {/if}
      </div>

      <div class="context-picker">
        <div>
          <span class="control-label">Мезоцикл</span>
          <div class="choice-row">
            {#each mesocycles as meso (meso.plan.id)}
              <button
                type="button"
                class="choice"
                class:active={selectedMesoId === meso.plan.id}
                style={`--choice-color: ${mesocycleColor(meso.index)}`}
                onclick={() => {
                  mesoPick = meso.plan.id;
                  microPick = null;
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
                  class:active={selectedMicroId === micro.plan.id}
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
              {@const slotIndex = (slotKey === 'B' ? 1 : 0) as 0 | 1}
              {@const slotDate = microcycle ? sessionDateForIndex(microcycle, slotIndex) : null}
              {@const slotProgress = microcycle ? sessionProgressFor(microcycle, slotIndex) : 0}
              <button
                type="button"
                class="slot-choice"
                class:active={activeSlot === slotKey}
                class:disabled={!microcycle}
                disabled={!microcycle}
                style={`--choice-color: ${slotColor(slotKey)}`}
                onclick={() => pickSession(slotKey)}
              >
                <b>{slot}</b>
                <span>
                  {slotLabel(slotKey)}
                  {#if microcycle}
                    <small>
                      {slotDate ? formatDateRu(slotDate) : 'без даты'}
                      {#if slotProgress > 0}
                        · {slotProgress}%
                      {/if}
                    </small>
                  {/if}
                </span>
              </button>
            {/each}
          </div>
        </div>
      </div>
    </section>

    {#if !sessionReady}
      <section class="card empty-state picker-empty">
        <h2>Тренировка не выбрана</h2>
        <p>
          Выберите мезоцикл, микроцикл и сессию — ниже появится план с целевыми весами. Заполните
          по кнопке «Готово» или отредактируйте уже записанные подходы.
        </p>
      </section>
    {:else}
      <div class="section-heading">
        <div>
          <h2>План сессии {activeSlot}</h2>
          <p>
            {#if sessionProgress === 100}
              Сессия записана — можно отредактировать отдельные упражнения.
            {:else if loggedPlanned > 0}
              Часть упражнений уже записана — дозаполните остальные или измените факт.
            {:else}
              Готово — принять план как есть. Изменить — если нужно подправить веса или подходы.
            {/if}
          </p>
        </div>
        <a
          class="button button-secondary"
          href="{base}/add?date={workoutDate}&meso={mesocycle?.plan.id}&micro={microcycle?.plan.id}&session={activeIndex}"
        >
          Добавить вне плана
        </a>
      </div>

      {#if slotExercises.length > 0}
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
  {/if}

  {#if sessionReady && outOfPlanEntries.length > 0}
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

  .onboarding,
  .picker-empty {
    margin-top: 16px;
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
    display: grid;
    gap: 2px;
    font-size: 10px;
    font-weight: 700;
  }

  .slot-choice span small {
    color: var(--muted);
    font-size: 8px;
    font-weight: 650;
  }

  .slot-choice:disabled {
    opacity: 0.45;
    cursor: not-allowed;
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
