<script lang="ts">
  import { base } from '$app/paths';
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import {
    exerciseProtocolSkipOnMicro,
    exerciseTargetOnMicro,
    exercisesForMicroSession,
    setSessionSkipped,
    sortExercisesByAnchorDesc,
    type EnrichedMicrocycle
  } from '$lib/cycle-plan';
  import { sessionPlanByIndex } from '$lib/micro-plan';
  import { createLog } from '$lib/database';
  import { mesoProtocolId } from '$lib/exercise-keys';
  import { formatDateRu, fmtNum, fmtSet, todayIso } from '$lib/format';
  import {
    indexToSlot,
    mesocycleColor,
    slotColor,
    slotLabel,
    type WorkoutSlot
  } from '$lib/microcycle';
  import {
    protocolGuideWeek,
    suggestPlannedSets,
    type PlannedSetsInput
  } from '$lib/planned-sets';
  import { thesesStore } from '$lib/training-theses';
  import type { ExerciseKind, ExerciseLog, ExerciseSet } from '$lib/types';
  import { TRAINING_VOLUME_GUIDE_ID } from '$lib/volume-guide';
  import { deleteSession, saveCyclePlanState, saveLog, workoutStore } from '$lib/workout-store';
  import { toasts } from '$lib/toast.svelte';

  let datePick = $state(todayIso());
  let mesoPick = $state<string | null>(null);
  let microPick = $state<string | null>(null);
  let slotPick = $state<WorkoutSlot | null>(null);
  let busyId = $state<string | null>(null);
  let bulkBusy = $state(false);
  let pickerOpen = $state(false);
  let error = $state('');
  let weightAdjust = $state<Record<string, number>>({});

  const WEIGHT_STEP = 2.5;

  function scrollIntoCenter(node: HTMLElement, selectedId: string | null) {
    const run = (id: string | null) => {
      const target =
        (id ? node.querySelector<HTMLElement>(`[data-meso-id="${id}"]`) : null) ??
        node.querySelector<HTMLElement>('.choice.active') ??
        (node.lastElementChild as HTMLElement | null);
      target?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    };
    requestAnimationFrame(() => run(selectedId));
    return {
      update(id: string | null) {
        requestAnimationFrame(() => run(id));
      }
    };
  }

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
      exercisesForMicroSession(mesocycle, view.workoutTemplates, activeIndex, view.keyMaps),
      mesocycle.anchorInfo
    );
  });
  const activeMicroSessionId = $derived.by(() => {
    if (!microcycle || activeIndex == null) return null;
    return sessionPlanByIndex(microcycle.plan, activeIndex)?.id ?? null;
  });
  const entriesForSession = $derived.by(() => {
    if (!sessionReady || !microcycle || activeIndex == null) return [];
    const msId = activeMicroSessionId;
    if (msId) {
      const linked = view.entries.filter((entry) => entry.microSessionId === msId);
      if (linked.length) {
        return linked.sort((a, b) => a.exercise.localeCompare(b.exercise, 'ru'));
      }
    }
    const sessionDate = sessionDateForIndex(microcycle, activeIndex);
    if (!sessionDate) return [];
    return view.entries
      .filter(
        (entry) => entry.date === sessionDate && slotExercises.includes(entry.exercise)
      )
      .sort((a, b) => a.exercise.localeCompare(b.exercise, 'ru'));
  });
  const usingManualPlan = $derived(view.cyclePlanView.usingManualPlan);
  const activeSessionPlan = $derived.by(() => {
    if (!microcycle || activeIndex == null) return null;
    return sessionPlanByIndex(microcycle.plan, activeIndex) ?? null;
  });
  const sessionSkipped = $derived(Boolean(activeSessionPlan?.skipped));
  let skipBusy = $state(false);

  function sessionSkippedFor(micro: EnrichedMicrocycle, index: 0 | 1): boolean {
    return Boolean(sessionPlanByIndex(micro.plan, index)?.skipped);
  }

  const entryByExercise = $derived(new Map(entriesForSession.map((entry) => [entry.exercise, entry])));
  const protocolSkips = $derived.by(() => {
    if (!mesocycle || !microcycle) return new Map<string, string | null>();
    const map = new Map<string, string | null>();
    for (const exercise of slotExercises) {
      const skip = exerciseProtocolSkipOnMicro(
        view.cyclePlanForCalc,
        mesocycle.plan,
        microcycle.plan,
        exercise,
        view.keyMaps
      );
      if (skip.skipped) map.set(exercise, skip.phaseLabel);
    }
    return map;
  });
  const requiredSlotExercises = $derived(
    slotExercises.filter((exercise) => !protocolSkips.has(exercise))
  );
  const loggedPlanned = $derived(
    requiredSlotExercises.filter((exercise) => entryByExercise.has(exercise)).length
  );
  const pendingPlanned = $derived(
    requiredSlotExercises.filter(
      (exercise) => !entryByExercise.has(exercise) && Boolean(adjustedPreviewSets(exercise))
    )
  );
  const sessionProgress = $derived(
    requiredSlotExercises.length
      ? Math.round((loggedPlanned / requiredSlotExercises.length) * 100)
      : slotExercises.length && protocolSkips.size === slotExercises.length
        ? 100
        : 0
  );
  const availableDates = $derived([...new Set(view.entries.map((entry) => entry.date))].sort().reverse());

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
  const outOfPlanEntries = $derived.by(() => {
    if (!sessionReady) return [];
    const msId = activeMicroSessionId;

    if (msId) {
      return view.entries
        .filter(
          (entry) => entry.microSessionId === msId && !slotExercises.includes(entry.exercise)
        )
        .sort((a, b) => a.exercise.localeCompare(b.exercise, 'ru'));
    }

    const sessionDate = plannedSessionDate;
    if (!sessionDate) return [];

    return view.entries
      .filter(
        (entry) =>
          entry.date === sessionDate &&
          !slotExercises.includes(entry.exercise) &&
          !entriesForSession.some((linked) => linked.id === entry.id)
      )
      .sort((a, b) => a.exercise.localeCompare(b.exercise, 'ru'));
  });

  function sessionDateForIndex(micro: EnrichedMicrocycle, index: 0 | 1): string | null {
    return index === 0 ? (micro.dayA?.date ?? null) : (micro.dayB?.date ?? null);
  }

  function sessionProgressFor(micro: EnrichedMicrocycle, index: 0 | 1): number {
    if (!mesocycle) return 0;
    const exercises = exercisesForMicroSession(mesocycle, view.workoutTemplates, index, view.keyMaps);
    if (!exercises.length) return 0;
    const date = sessionDateForIndex(micro, index);
    if (!date) return 0;
    const logged = exercises.filter((exercise) =>
      view.entries.some((entry) => entry.date === date && entry.exercise === exercise)
    ).length;
    return Math.round((logged / exercises.length) * 100);
  }

  function pickSession(slot: WorkoutSlot) {
    autoPicked = false;
    slotPick = slot;
    pickerOpen = false;
    if (!microcycle) return;
    const planned = sessionDateForIndex(microcycle, slot === 'B' ? 1 : 0);
    datePick = planned ?? todayIso();
  }

  function exerciseKind(name: string): ExerciseKind {
    return workoutStore.database.exercises.find((item) => item.name === name)?.kind ?? 'strength';
  }

  function plannedInput(exerciseName: string): PlannedSetsInput | null {
    if (!mesocycle || !microcycle) return null;
    const protocolId =
      mesoProtocolId(mesocycle.plan, exerciseName, view.keyMaps) ?? mesocycle.plan.templateId;
    const guide = thesesStore.protocolGuideFor(protocolId);
    const sessionDate = sessionPlanByIndex(microcycle.plan, activeIndex ?? 0)?.date;
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
      volumeGuideRows,
      allowLastWorkoutFallback: Boolean(sessionDate)
    };
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

  function setChipText(kind: ExerciseKind, set: ExerciseSet): string {
    const [first, second] = set;
    if (kind === 'run') return `${first}′ · ${second} км/ч`;
    if (kind === 'jumps') return `${first}×${second}`;
    return fmtSet(first, second);
  }

  function planStats(sets: ExerciseSet[]) {
    const count = sets.length;
    const totalReps = sets.reduce((sum, [, reps]) => sum + reps, 0);
    const tonnage = sets.reduce((sum, [weight, reps]) => sum + weight * reps, 0);
    const repsList = sets.map(([, reps]) => reps);
    const weightList = sets.map(([weight]) => weight);
    const uniformReps = repsList.length > 0 && repsList.every((reps) => reps === repsList[0]);
    const uniformWeight = weightList.length > 0 && weightList.every((w) => w === weightList[0]);
    return {
      count,
      totalReps,
      tonnage,
      maxWeight: weightList.length ? Math.max(...weightList) : 0,
      uniform: count > 0 && uniformReps && uniformWeight,
      weight: weightList[0] ?? 0,
      reps: repsList[0] ?? 0,
      repScheme: uniformReps ? String(repsList[0]) : null
    };
  }

  function applyWeightDelta(sets: ExerciseSet[], kind: ExerciseKind, delta: number): ExerciseSet[] {
    if (!delta || kind !== 'strength') return sets;
    return sets.map(([weight, reps]) => [Math.max(0, weight + delta), reps] as ExerciseSet);
  }

  function nudgeWeight(exerciseName: string, direction: 1 | -1) {
    const current = weightAdjust[exerciseName] ?? 0;
    weightAdjust = { ...weightAdjust, [exerciseName]: current + direction * WEIGHT_STEP };
  }

  function adjustedPreviewSets(
    exerciseName: string
  ): { kind: ExerciseKind; sets: ExerciseSet[] } | null {
    if (protocolSkips.has(exerciseName)) return null;
    const input = plannedInput(exerciseName);
    if (!input) return null;
    const sets = applyWeightDelta(
      suggestPlannedSets(input),
      input.kind,
      weightAdjust[exerciseName] ?? 0
    );
    if (!sets.length) return null;
    return { kind: input.kind, sets };
  }

  async function saveSetsFor(
    exerciseName: string,
    kind: ExerciseKind,
    sets: ExerciseSet[],
    successMessage: string,
    silent = false
  ) {
    if (!mesocycle || !microcycle || activeIndex == null) return;
    busyId = exerciseName;
    error = '';
    try {
      const { db, log } = createLog(
        workoutStore.database,
        exerciseName,
        workoutDate,
        [{ kind, sets, comment: null }],
        crypto.randomUUID()
      );
      workoutStore.database = db;
      await saveLog(log, {
        mesoId: mesocycle.plan.id,
        microId: microcycle.plan.id,
        indexInMicro: activeIndex
      });
      weightAdjust = { ...weightAdjust, [exerciseName]: 0 };
      if (!silent) toasts.success(successMessage);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось сохранить';
      error = message;
      toasts.error(message);
    } finally {
      busyId = null;
    }
  }

  async function confirmPlanned(exerciseName: string) {
    if (protocolSkips.has(exerciseName)) return;
    const input = plannedInput(exerciseName);
    if (!input) return;
    const sets = applyWeightDelta(
      suggestPlannedSets(input),
      input.kind,
      weightAdjust[exerciseName] ?? 0
    );
    await saveSetsFor(exerciseName, input.kind, sets, `Записано: ${exerciseName}`);
  }

  async function confirmAllPlanned() {
    if (bulkBusy) return;
    const targets = pendingPlanned.slice();
    if (!targets.length) return;
    bulkBusy = true;
    error = '';
    let saved = 0;
    try {
      for (const exerciseName of targets) {
        const input = plannedInput(exerciseName);
        if (!input) continue;
        const sets = applyWeightDelta(
          suggestPlannedSets(input),
          input.kind,
          weightAdjust[exerciseName] ?? 0
        );
        if (!sets.length) continue;
        await saveSetsFor(exerciseName, input.kind, sets, '', true);
        if (!error) saved += 1;
        if (error) break;
      }
      if (saved > 0 && !error) {
        toasts.success(saved === 1 ? 'Записано 1 упражнение' : `Записано упражнений: ${saved}`);
      }
    } finally {
      bulkBusy = false;
    }
  }

  function sessionProgressOf(meso: (typeof mesocycles)[number], micro: EnrichedMicrocycle, index: 0 | 1) {
    const exercises = exercisesForMicroSession(meso, view.workoutTemplates, index, view.keyMaps);
    if (!exercises.length) return { progress: 0, hasExercises: false };
    const required = exercises.filter((exercise) => {
      const skip = exerciseProtocolSkipOnMicro(
        view.cyclePlanForCalc,
        meso.plan,
        micro.plan,
        exercise,
        view.keyMaps
      );
      return !skip.skipped;
    });
    if (!required.length) {
      return { progress: 100, hasExercises: true };
    }
    const date = sessionDateForIndex(micro, index);
    if (!date) return { progress: 0, hasExercises: true };
    const logged = required.filter((exercise) =>
      view.entries.some((entry) => entry.date === date && entry.exercise === exercise)
    ).length;
    return { progress: Math.round((logged / required.length) * 100), hasExercises: true };
  }

  function daysFromToday(date: string): number {
    const day = 86_400_000;
    return Math.round((Date.parse(date) - Date.parse(todayIso())) / day);
  }

  // «Ближайшая незаполненная»: среди всех сессий плана с упражнениями и прогрессом < 100%
  // берём ту, что ближе всего к сегодня по дате; сессии без даты — по порядку плана, в конце.
  function findNearestIncomplete(): { mesoId: string; microId: string; slot: WorkoutSlot } | null {
    type Candidate = {
      mesoId: string;
      microId: string;
      index: 0 | 1;
      date: string | null;
      order: number;
    };
    const candidates: Candidate[] = [];
    let order = 0;
    for (const meso of mesocycles) {
      for (const micro of meso.microcycles) {
        for (const index of [0, 1] as const) {
          order += 1;
          if (sessionSkippedFor(micro, index)) continue;
          const { progress, hasExercises } = sessionProgressOf(meso, micro, index);
          if (!hasExercises || progress >= 100) continue;
          candidates.push({
            mesoId: meso.plan.id,
            microId: micro.plan.id,
            index,
            date: sessionDateForIndex(micro, index),
            order
          });
        }
      }
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      if (a.date && b.date) {
        const diff = Math.abs(daysFromToday(a.date)) - Math.abs(daysFromToday(b.date));
        return diff !== 0 ? diff : a.date.localeCompare(b.date);
      }
      if (a.date) return -1;
      if (b.date) return 1;
      return a.order - b.order;
    });
    const best = candidates[0];
    return { mesoId: best.mesoId, microId: best.microId, slot: best.index === 1 ? 'B' : 'A' };
  }

  let autoSelected = $state(false);
  let autoPicked = $state(false);
  $effect(() => {
    if (autoSelected) return;
    // Уважаем явный выбор: через URL (со страницы «План») или вручную кликом.
    if (urlMeso || urlMicro || urlSession !== null || mesoPick || microPick || slotPick) {
      autoSelected = true;
      return;
    }
    // Ждём, пока стор поднимет журнал — иначе все сессии выглядят пустыми
    // и «ближайшей» окажется уже закрытая тренировка.
    if (!workoutStore.bootstrapped || !mesocycles.length) return;
    const pick = findNearestIncomplete();
    if (pick) {
      mesoPick = pick.mesoId;
      microPick = pick.microId;
      slotPick = pick.slot;
      const micro = mesocycles
        .find((meso) => meso.plan.id === pick.mesoId)
        ?.microcycles.find((item) => item.plan.id === pick.microId);
      const plannedDate = micro ? sessionDateForIndex(micro, pick.slot === 'B' ? 1 : 0) : null;
      datePick = plannedDate ?? todayIso();
      autoPicked = true;
    }
    autoSelected = true;
  });

  async function setSkip(skip: boolean) {
    if (!mesocycle || !microcycle || activeIndex == null) return;
    if (!usingManualPlan) {
      toasts.error('Сначала откройте и сохраните план в разделе «План».');
      return;
    }
    const basePlan = workoutStore.view.cyclePlanView.plan;
    if (!basePlan) {
      toasts.error('Сначала откройте и сохраните план в разделе «План».');
      return;
    }
    const mesoId = mesocycle.plan.id;
    const microId = microcycle.plan.id;
    const idx = activeIndex;
    skipBusy = true;
    error = '';
    try {
      saveCyclePlanState(setSessionSkipped(basePlan, mesoId, microId, idx, skip));
      if (skip) {
        toasts.undo('Тренировка пропущена', () => {
          const current = workoutStore.view.cyclePlanView.plan;
          if (!current) return;
          saveCyclePlanState(setSessionSkipped(current, mesoId, microId, idx, false));
          toasts.success('Тренировка возвращена в план');
        });
      } else {
        toasts.success('Тренировка возвращена в план');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось обновить план';
      error = message;
      toasts.error(message);
    } finally {
      skipBusy = false;
    }
  }

  async function removeEntry(id: string | undefined) {
    if (!id) return;
    const snapshot: ExerciseLog | undefined = workoutStore.database.logs.find((item) => item.id === id);
    busyId = id;
    error = '';
    try {
      await deleteSession(id);
      if (snapshot) {
        toasts.undo('Запись удалена', async () => {
          await saveLog(snapshot);
          toasts.success('Запись восстановлена');
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось удалить запись';
      error = message;
      toasts.error(message);
    } finally {
      busyId = null;
    }
  }
</script>

{#snippet specSub(kind: ExerciseKind, sets: ExerciseSet[], anchor1rm: number | null, pct: number | null, pctLabel: string)}
  {#if kind === 'strength' && sets.length}
    {@const st = planStats(sets)}
    <p class="rx-sub">
      {#if anchor1rm}<span>1ПМ {fmtNum(anchor1rm)} кг</span>{/if}
      {#if pct}<span>{pct}% {pctLabel}</span>{/if}
      <span>Σ {st.totalReps} повт</span>
      <span>объём {fmtNum(st.tonnage)} кг</span>
    </p>
  {/if}
{/snippet}

<div class="container dashboard">
  <header class="page-header">
    <div>
      <div class="eyebrow">
        {sessionReady ? 'Тренировка' : 'Обзор'}
        {#if autoPicked && sessionReady}
          <span class="auto-badge">авто · ближайшая незаполненная</span>
        {/if}
      </div>
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
      <div class="training-top" class:collapsed={sessionReady && !pickerOpen}>
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
              {#if sessionSkipped}
                · <span class="skip-flag">пропущена</span>
              {/if}
            </p>
          {:else if mesocycle && microcycle}
            <p>Микроцикл {microcycle.plan.indexInMeso} — выберите сессию A или B</p>
          {:else if mesocycle}
            <p>Выберите микроцикл, затем сессию A или B</p>
          {/if}
        </div>
        {#if sessionReady}
          <div class="training-top-aside">
            <button
              type="button"
              class="button button-ghost picker-toggle"
              aria-expanded={pickerOpen}
              onclick={() => (pickerOpen = !pickerOpen)}
            >
              {pickerOpen ? 'Свернуть' : 'Сменить'}
            </button>
            <div
              class="session-ring"
              class:skipped={sessionSkipped}
              style={`--progress: ${sessionProgress * 3.6}deg`}
            >
              <span>{sessionSkipped ? 'skip' : `${sessionProgress}%`}</span>
            </div>
          </div>
        {/if}
      </div>

      {#if !sessionReady || pickerOpen}
      <div class="context-picker">
        <div>
          <span class="control-label">Мезоцикл</span>
          <div class="choice-row" use:scrollIntoCenter={selectedMesoId}>
            {#each mesocycles as meso (meso.plan.id)}
              <button
                type="button"
                class="choice"
                class:active={selectedMesoId === meso.plan.id}
                data-meso-id={meso.plan.id}
                style={`--choice-color: ${mesocycleColor(meso.index)}`}
                onclick={() => {
                  autoPicked = false;
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
                    autoPicked = false;
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
              {@const slotSkipped = microcycle ? sessionSkippedFor(microcycle, slotIndex) : false}
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
                      {#if slotSkipped}
                        · пропущена
                      {:else if slotProgress > 0}
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
      {/if}
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
            {#if sessionSkipped}
              Тренировка отмечена пропущенной — она не учитывается в незаполненных.
            {:else if sessionProgress === 100}
              Сессия записана — можно отредактировать отдельные упражнения.
            {:else if loggedPlanned > 0}
              Часть упражнений уже записана — дозаполните остальные или измените факт.
            {:else}
              Готово — принять план как есть. Изменить — если нужно подправить веса или подходы.
            {/if}
          </p>
        </div>
        <div class="heading-actions">
          {#if !sessionSkipped && pendingPlanned.length > 0}
            <button
              type="button"
              class="button button-primary"
              disabled={bulkBusy || busyId !== null}
              title="Записать все плановые упражнения по целевым весам"
              onclick={confirmAllPlanned}
            >
              {bulkBusy ? 'Записываем…' : `Записать всё (${pendingPlanned.length})`}
            </button>
          {/if}
          {#if !sessionSkipped && requiredSlotExercises.length > 0 && loggedPlanned === 0}
            <button
              type="button"
              class="button button-ghost"
              disabled={skipBusy}
              title="Не делал эту тренировку — убрать из незаполненных"
              onclick={() => setSkip(true)}
            >
              {skipBusy ? '…' : 'Пропустить'}
            </button>
          {/if}
          <a
            class="button button-secondary"
            href="{base}/add?date={workoutDate}&meso={mesocycle?.plan.id}&micro={microcycle?.plan.id}&session={activeIndex}"
          >
            Добавить вне плана
          </a>
        </div>
      </div>

      {#if !sessionSkipped && sessionProgress === 100 && requiredSlotExercises.length > 0}
        <section class="card session-done">
          <div class="session-done-main">
            <div class="eyebrow">Готово</div>
            <h2>Сессия {activeSlot} записана</h2>
            <p>Все запланированные упражнения внесены в журнал. Отдельные подходы можно поправить ниже.</p>
          </div>
          <div class="session-done-actions">
            <a class="button button-secondary" href="{base}/history">Открыть журнал</a>
            <a class="button button-secondary" href="{base}/stats">Аналитика</a>
          </div>
        </section>
      {/if}

      {#if sessionSkipped}
        <section class="card empty-state skipped-state">
          <div class="eyebrow">Сессия {activeSlot} пропущена</div>
          <h2>Тренировка не выполнялась</h2>
          <p>
            Эта сессия не считается незаполненной и не выбирается автоматически. Можно вернуть её
            в план в любой момент.
          </p>
          <button
            type="button"
            class="button button-primary"
            disabled={skipBusy}
            onclick={() => setSkip(false)}
          >
            {skipBusy ? '…' : 'Вернуть в план'}
          </button>
        </section>
      {:else if slotExercises.length > 0}
      <section class="exercise-grid">
        {#each slotExercises as exercise, index (exercise)}
          {@const entry = entryByExercise.get(exercise)}
          {@const hint = protocolHints.get(exercise)}
          {@const protocolSkip = protocolSkips.get(exercise)}
          {@const previewSets = entry ? null : adjustedPreviewSets(exercise)}
          <article
            class="exercise-item"
            class:complete={Boolean(entry)}
            class:protocol-skipped={Boolean(protocolSkip) && !entry}
          >
            <div class="exercise-index">{entry ? '✓' : protocolSkip ? '—' : index + 1}</div>
            <div class="exercise-content">
              <div class="exercise-heading">
                <div>
                  <h3>{exercise}</h3>
                  {#if entry}
                    <div class="plan-meta logged">
                      <div class="plan-sets">
                        {#each entry.sets as set, setIndex}
                          <span class="set-chip">
                            <em>{setIndex + 1}</em>{setChipText(entry.kind, set)}
                          </span>
                        {/each}
                      </div>
                      {@render specSub(entry.kind, entry.sets, hint?.anchor1rm ?? null, hint?.maxPct ?? null, 'макс')}
                    </div>
                  {:else if protocolSkip}
                    <div class="plan-meta protocol-skip">
                      <span class="protocol-skip-badge">Пропускаем в этом μ</span>
                      <span class="protocol-skip-note">По протоколу без силовой нагрузки</span>
                    </div>
                  {:else if hint || previewSets}
                    {@const ps = previewSets ? planStats(previewSets.sets) : null}
                    <div class="plan-meta">
                      {#if previewSets && previewSets.kind === 'strength' && ps?.uniform}
                        <div class="rx">
                          <span class="rx-weight">{fmtNum(ps.weight)}<small>кг</small></span>
                          <span class="rx-scheme">{ps.count} × {ps.reps}</span>
                          {#if hint}
                            <span class="target-pct">{hint.targetPct}%<small>1ПМ</small></span>
                          {/if}
                        </div>
                      {:else}
                        {#if hint}
                          <div class="plan-target">
                            <span class="target-weight">
                              {fmtNum(hint.targetWeight)}<small>кг</small>
                            </span>
                            <span class="target-pct">
                              {hint.targetPct}%<small>1ПМ</small>
                            </span>
                          </div>
                        {/if}
                        {#if previewSets}
                          <div class="plan-sets">
                            {#each previewSets.sets as set, setIndex}
                              <span class="set-chip">
                                <em>{setIndex + 1}</em>{setChipText(previewSets.kind, set)}
                              </span>
                            {/each}
                          </div>
                        {/if}
                      {/if}
                      {#if previewSets}
                        {@render specSub(previewSets.kind, previewSets.sets, hint?.anchor1rm ?? null, null, '')}
                      {/if}
                    </div>
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
                  {:else if protocolSkip}
                    <!-- actions hidden: protocol skip -->
                  {:else}
                    {#if exerciseKind(exercise) === 'strength'}
                      <div class="weight-stepper" role="group" aria-label="Поправка веса">
                        <button
                          type="button"
                          aria-label="Меньше на {WEIGHT_STEP} кг"
                          disabled={busyId === exercise}
                          onclick={() => nudgeWeight(exercise, -1)}
                        >
                          −
                        </button>
                        <span class:dim={!(weightAdjust[exercise] ?? 0)}>
                          {#if (weightAdjust[exercise] ?? 0) === 0}
                            ±0
                          {:else}
                            {(weightAdjust[exercise] ?? 0) > 0 ? '+' : '−'}{fmtNum(Math.abs(weightAdjust[exercise] ?? 0))}
                          {/if}
                          <small>кг</small>
                        </span>
                        <button
                          type="button"
                          aria-label="Больше на {WEIGHT_STEP} кг"
                          disabled={busyId === exercise}
                          onclick={() => nudgeWeight(exercise, 1)}
                        >
                          +
                        </button>
                      </div>
                    {/if}
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

  .auto-badge {
    margin-left: 8px;
    padding: 2px 7px;
    color: var(--accent-ink);
    background: var(--accent);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    vertical-align: middle;
  }

  .date-control {
    width: 176px;
  }

  .date-control span,
  .control-label {
    display: block;
    margin-bottom: 7px;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
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

  .training-top.collapsed {
    padding-bottom: 0;
    border-bottom: 0;
  }

  .training-top-aside {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .picker-toggle {
    white-space: nowrap;
  }

  .training-top h2 {
    margin: 6px 0 6px;
    font-size: 30px;
    letter-spacing: 0.01em;
  }

  .training-top p {
    margin: 0;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11.5px;
  }

  .session-ring {
    display: grid;
    width: 70px;
    height: 70px;
    flex: 0 0 auto;
    place-items: center;
    background:
      radial-gradient(circle closest-side, #15171c 76%, transparent 78% 100%),
      conic-gradient(var(--accent) var(--progress), #2a313d 0);
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--line-strong);
  }

  .session-ring span {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 800;
  }

  .session-ring.skipped {
    background:
      radial-gradient(circle closest-side, #15171c 76%, transparent 78% 100%),
      conic-gradient(var(--muted) 360deg, #2a313d 0);
  }

  .session-ring.skipped span {
    color: var(--muted);
    font-size: 11px;
    text-transform: uppercase;
  }

  .heading-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }

  .skip-flag {
    color: var(--hazard, #f5a524);
    font-weight: 700;
  }

  .skipped-state {
    border-left: 3px solid var(--hazard, #f5a524);
  }

  .session-done {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 16px;
    border-left: 3px solid var(--accent);
  }

  .session-done-main h2 {
    margin: 4px 0 4px;
    font-size: 20px;
  }

  .session-done-main p {
    margin: 0;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11.5px;
  }

  .session-done-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
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
    background: #0e1014;
    border: 1px solid var(--line);
    border-radius: 0;
    font-family: var(--font-mono);
    cursor: pointer;
    transition: border-color 120ms ease, background 120ms ease;
  }

  .choice:hover,
  .micro-choice:hover,
  .slot-choice:hover {
    border-color: var(--line-strong);
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
    background: rgb(204 255 51 / 8%);
    border-color: rgb(204 255 51 / 40%);
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
    color: #0b0c0f;
    background: var(--choice-color);
    border-radius: 0;
    font-weight: 800;
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
    background: linear-gradient(150deg, #1a1d24, #121419);
    border: 1px solid var(--line);
    border-left: 2px solid var(--line-strong);
    border-radius: var(--radius);
    transition: border-color 130ms ease;
  }

  .exercise-item:hover {
    border-left-color: var(--accent);
  }

  .exercise-item.complete {
    border-color: rgb(204 255 51 / 22%);
    border-left-color: var(--accent);
  }

  .exercise-index {
    display: grid;
    width: 34px;
    height: 34px;
    place-items: center;
    color: var(--muted);
    background: #0a0c10;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 800;
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
    font-size: 18px;
    letter-spacing: 0.01em;
  }

  .exercise-heading p {
    margin: 0;
    color: var(--muted);
    font-size: 11px;
  }

  .plan-meta {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
  }

  .plan-target {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 10px 14px;
  }

  .target-weight {
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 22px;
    font-weight: 700;
    line-height: 1;
  }

  .target-weight small {
    margin-left: 3px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 500;
  }

  .target-pct {
    padding: 4px 9px;
    color: var(--accent);
    background: #0a0c10;
    border: 1px solid var(--line-strong);
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 700;
    line-height: 1;
  }

  .target-pct small {
    margin-left: 5px;
    color: var(--muted);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .plan-sets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .set-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 9px 5px 7px;
    color: var(--muted-strong);
    background: #0a0c10;
    border: 1px solid var(--line);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
  }

  .set-chip em {
    min-width: 12px;
    color: var(--muted);
    font-style: normal;
    font-size: 10px;
    font-weight: 700;
    text-align: center;
  }

  .exercise-item.complete .set-chip {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 40%, var(--line));
  }

  .rx {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 10px 12px;
  }

  .rx-weight {
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 24px;
    font-weight: 700;
    line-height: 1;
  }

  .rx-weight small {
    margin-left: 3px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 500;
  }

  .rx-scheme {
    align-self: center;
    padding: 4px 10px;
    color: var(--text);
    background: #0a0c10;
    border: 1px solid var(--line-strong);
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  .rx-sub {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin: 2px 0 0;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
  }

  .rx-sub span {
    position: relative;
  }

  .rx-sub span + span::before {
    content: '·';
    position: absolute;
    left: -8px;
    color: var(--line-strong);
  }

  .exercise-item.protocol-skipped {
    opacity: 0.72;
  }

  .exercise-item.protocol-skipped .exercise-index {
    color: var(--muted);
    border-color: var(--line);
  }

  .protocol-skip-badge {
    display: inline-block;
    padding: 5px 10px;
    color: var(--muted-strong);
    background: #0a0c10;
    border: 1px dashed var(--line-strong);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .protocol-skip-note {
    display: block;
    margin-top: 4px;
    color: var(--muted);
    font-size: 11px;
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

  .weight-stepper {
    display: inline-flex;
    align-items: center;
    height: 40px;
    border: 1px solid var(--line-strong);
    background: #0a0c10;
  }

  .weight-stepper button {
    width: 38px;
    height: 100%;
    color: var(--text);
    background: transparent;
    border: 0;
    cursor: pointer;
    font-size: 20px;
    line-height: 1;
  }

  .weight-stepper button:hover:not(:disabled) {
    color: var(--accent);
    background: var(--surface-raised);
  }

  .weight-stepper button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .weight-stepper span {
    min-width: 56px;
    padding: 0 4px;
    border-inline: 1px solid var(--line);
    color: var(--accent);
    text-align: center;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 700;
  }

  .weight-stepper span small {
    margin-left: 3px;
    color: var(--muted);
    font-size: 9px;
    font-weight: 600;
  }

  .weight-stepper span.dim {
    color: var(--muted);
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
    background: #0a0c10;
    border: 1px solid var(--line);
    border-radius: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
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
    background: rgb(255 92 82 / 12%);
    border: 1px solid rgb(255 92 82 / 30%);
    border-left: 3px solid var(--danger);
    border-radius: 0;
    font-family: var(--font-mono);
    font-size: 12px;
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
