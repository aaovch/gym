<script lang="ts">
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import {
    IconArrowRight,
    IconCheck,
    IconFocus2,
    IconLock,
    IconRotate2,
    IconX
  } from '@tabler/icons-svelte';
  import {
    assignSessionDate,
    exerciseProtocolSkipOnMicro,
    exerciseTargetOnMicro,
    exercisesForMicroSession,
    markAnchorManual,
    removeExerciseFromMeso,
    resolveMesoMicroSelection,
    setSessionSkipped,
    sortExercisesByAnchorDesc,
    suggestSessionIndex,
    updateExerciseProtocol,
    updateExerciseSessions,
    updateSessionExercisePlan,
    type EnrichedMicrocycle,
    type PlannedExercisePlan
  } from '$lib/cycle-plan';
  import { sessionPlanByIndex } from '$lib/micro-plan';
  import { completedRowSets } from '$lib/database';
  import { completionPhrase } from '$lib/completion-phrases';
  import {
    adjacentExercise,
    allPlannedSetsFailed,
    holdPointerMoved,
    horizontalSwipeDirection,
    MOBILE_EXERCISE_HOLD_MS,
    recordedSetRepeatAction,
    type ExerciseMoveDirection
  } from '$lib/mobile-exercise-navigation';
  import { randomUuid } from '$lib/id';
  import { mesoProtocolId, toExerciseId } from '$lib/exercise-keys';
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
  import type { ExerciseKind, ExerciseLog, ExerciseSet, SessionRow, WorkoutEntry } from '$lib/types';
  import { TRAINING_VOLUME_GUIDE_ID } from '$lib/volume-guide';
  import {
    extraEntriesForSession,
    plannedEntriesForSession,
    preferredSessionInLatestMeso,
    preferredSessionForDate,
    type SessionRoutingRef
  } from '$lib/session-entry-routing';
  import { deleteSession, saveCyclePlanState, saveExerciseLog, saveLog, workoutStore } from '$lib/workout-store';
  import { toasts } from '$lib/toast.svelte';

  let datePick = $state(todayIso());
  let mesoPick = $state<string | null>(null);
  let microPick = $state<string | null>(null);
  let slotPick = $state<WorkoutSlot | null>(null);
  let busyId = $state<string | null>(null);
  let bulkBusy = $state(false);
  let pickerOpen = $state(false);
  let error = $state('');
  let planQuickBusy = $state<string | null>(null);
  type PlanExerciseDraft = {
    exercise: string;
    kind: ExerciseKind;
    sets: [string, string][];
    customSets: boolean;
    anchor1rm: string;
    protocolId: string;
    sessions: (0 | 1)[];
  };
  let planDraft = $state<PlanExerciseDraft | null>(null);
  let planEditBusy = $state(false);
  let undoNotice = $state<{ key: string; setNumber: number } | null>(null);
  let pendingActualWeights = $state<Record<string, number>>({});
  let mobileFocusExercise = $state<string | null>(null);
  let mobileFocusSessionKey = $state('');
  let mobileExerciseHoldTarget = $state<string | null>(null);
  let mobileSwipeStart: { x: number; y: number } | null = null;
  let mobileExerciseHoldStart: {
    input: 'pointer' | 'touch';
    id: number;
    x: number;
    y: number;
  } | null = null;
  let mobileExerciseHoldTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressMobileExerciseClick = false;

  const WEIGHT_STEP = 0.5;

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
  function exerciseInteractionKey(exerciseName: string): string {
    return `${mesocycle?.plan.id ?? ''}:${microcycle?.plan.id ?? ''}:${activeIndex ?? ''}:${exerciseName}`;
  }

  function exerciseCompletionPhrase(exerciseName: string): string {
    return completionPhrase(`${exerciseInteractionKey(exerciseName)}:${workoutDate}`);
  }

  function scrollMobileExerciseIntoView(node: HTMLElement, exerciseName: string | null) {
    const centerActiveExercise = () => {
      const target = node.querySelector<HTMLElement>('.mobile-exercise-tab.active');
      if (!target) return;
      const left = target.offsetLeft - (node.clientWidth - target.clientWidth) / 2;
      node.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
    };
    requestAnimationFrame(centerActiveExercise);
    return {
      update(nextExerciseName: string | null) {
        if (nextExerciseName !== exerciseName) requestAnimationFrame(centerActiveExercise);
        exerciseName = nextExerciseName;
      }
    };
  }

  function focusMobileExercise(exerciseName: string, behavior: ScrollBehavior = 'smooth') {
    if (!slotExercises.includes(exerciseName) || mobileFocusExercise === exerciseName) return;
    mobileFocusExercise = exerciseName;
    undoNotice = null;
    if (browser) window.scrollTo({ top: 0, behavior });
  }

  function moveMobileExercise(direction: ExerciseMoveDirection) {
    const nextExercise = adjacentExercise(slotExercises, mobileFocusExercise, direction);
    if (nextExercise) focusMobileExercise(nextExercise, 'auto');
  }

  function clearMobileExerciseHold() {
    if (mobileExerciseHoldTimer) clearTimeout(mobileExerciseHoldTimer);
    mobileExerciseHoldTimer = null;
    mobileExerciseHoldTarget = null;
    mobileExerciseHoldStart = null;
  }

  function scheduleMobileExerciseHold(
    exerciseName: string,
    start: NonNullable<typeof mobileExerciseHoldStart>
  ) {
    clearMobileExerciseHold();
    suppressMobileExerciseClick = false;
    mobileExerciseHoldTarget = exerciseName;
    mobileExerciseHoldStart = start;
    mobileExerciseHoldTimer = setTimeout(() => {
      mobileExerciseHoldTimer = null;
      mobileExerciseHoldTarget = null;
      mobileExerciseHoldStart = null;
      suppressMobileExerciseClick = true;
      void markExerciseNotDone(exerciseName);
    }, MOBILE_EXERCISE_HOLD_MS);
  }

  function beginMobileExerciseHold(event: PointerEvent, exerciseName: string) {
    if (
      event.pointerType === 'touch' ||
      !event.isPrimary ||
      (event.pointerType === 'mouse' && event.button !== 0)
    ) return;
    scheduleMobileExerciseHold(exerciseName, {
      input: 'pointer',
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY
    });
    const target = event.currentTarget as HTMLElement;
    if ('setPointerCapture' in target) {
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // Some mobile browsers expose Pointer Events without pointer capture.
      }
    }
  }

  function moveMobileExerciseHold(event: PointerEvent) {
    const start = mobileExerciseHoldStart;
    if (!start || start.input !== 'pointer' || start.id !== event.pointerId) return;
    if (holdPointerMoved(start.x, start.y, event.clientX, event.clientY)) clearMobileExerciseHold();
  }

  function beginMobileExerciseTouchHold(event: TouchEvent, exerciseName: string) {
    if (event.touches.length !== 1) {
      clearMobileExerciseHold();
      return;
    }
    const touch = event.touches[0];
    scheduleMobileExerciseHold(exerciseName, {
      input: 'touch',
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY
    });
  }

  function moveMobileExerciseTouchHold(event: TouchEvent) {
    const start = mobileExerciseHoldStart;
    if (!start || start.input !== 'touch') return;
    const touch = Array.from(event.touches).find((item) => item.identifier === start.id);
    if (!touch || holdPointerMoved(start.x, start.y, touch.clientX, touch.clientY)) {
      clearMobileExerciseHold();
    }
  }

  function finishMobileExerciseHold() {
    clearMobileExerciseHold();
  }

  async function handleMobileExerciseClick(exerciseName: string) {
    if (suppressMobileExerciseClick) {
      suppressMobileExerciseClick = false;
      return;
    }
    if (mobileExerciseProgress(exerciseName).notDone) {
      await restoreExerciseNotDone(exerciseName);
      return;
    }
    focusMobileExercise(exerciseName);
  }

  function beginMobileExerciseSwipe(event: TouchEvent) {
    if (event.touches.length !== 1) {
      mobileSwipeStart = null;
      return;
    }
    mobileSwipeStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }

  function finishMobileExerciseSwipe(event: TouchEvent) {
    const start = mobileSwipeStart;
    mobileSwipeStart = null;
    if (!start || event.changedTouches.length !== 1) return;
    const touch = event.changedTouches[0];
    const direction = horizontalSwipeDirection(start.x, start.y, touch.clientX, touch.clientY);
    if (direction) moveMobileExercise(direction);
  }

  function nextIncompleteExercise(exerciseName: string): string | null {
    const currentIndex = slotExercises.indexOf(exerciseName);
    const followingExercises = currentIndex >= 0
      ? [...slotExercises.slice(currentIndex + 1), ...slotExercises.slice(0, currentIndex)]
      : slotExercises;
    return followingExercises.find((candidate) =>
      !protocolSkips.has(candidate) &&
      !isExerciseFullyLogged(candidate, entryByExercise.get(candidate))
    ) ?? null;
  }

  async function continueToNextExercise(exerciseName: string) {
    const nextExercise = nextIncompleteExercise(exerciseName);
    if (!nextExercise) {
      const params = new URLSearchParams({ profile: workoutStore.profile.urlSlug });
      await goto(`${base}/history?${params.toString()}`);
      return;
    }
    focusMobileExercise(nextExercise);
  }
  const sessionReady = $derived(mesocycle != null && microcycle != null && activeIndex != null);
  const activeSlot = $derived(activeIndex != null ? indexToSlot(activeIndex) : null);
  const plannedSessionDate = $derived.by(() => {
    if (!microcycle || activeIndex == null) return null;
    return sessionDateForIndex(microcycle, activeIndex);
  });
  const sessionHeadline = $derived.by(() => {
    if (!sessionReady || !activeSlot) return null;
    if (plannedSessionDate) {
      return plannedSessionDate === todayIso() ? 'Сегодня' : formatDateRu(plannedSessionDate);
    }
    if (mesocycle && microcycle) {
      return `${mesocycle.plan.label} · ${slotLabel(activeSlot)}`;
    }
    return slotLabel(activeSlot);
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
  const validMicroSessionIds = $derived.by(() => {
    const ids = new Set<string>();
    for (const meso of mesocycles) {
      for (const micro of meso.microcycles) {
        for (const session of micro.plan.sessions) ids.add(session.id);
      }
    }
    return ids;
  });

  function planEditorUrl(scope: 'plan' | 'session'): string {
    const params = new URLSearchParams({
      profile: workoutStore.profile.urlSlug
    });
    if (mesocycle) params.set('meso', mesocycle.plan.id);
    params.set('edit', scope);
    if (scope === 'session' && microcycle && activeIndex != null) {
      params.set('micro', microcycle.plan.id);
      params.set('session', String(activeIndex));
    }
    return `${base}/cycles?${params.toString()}`;
  }
  const entriesForSession = $derived.by(() => {
    if (!sessionReady) return [];
    return plannedEntriesForSession(view.entries, {
      activeMicroSessionId,
      validMicroSessionIds,
      workoutDate,
      slotExercises
    })
      .sort((a, b) => a.exercise.localeCompare(b.exercise, 'ru'));
  });
  const usingManualPlan = $derived(view.cyclePlanView.usingManualPlan);
  const activeSessionPlan = $derived.by(() => {
    if (!microcycle || activeIndex == null) return null;
    return sessionPlanByIndex(microcycle.plan, activeIndex) ?? null;
  });
  const sessionSkipped = $derived(Boolean(activeSessionPlan?.skipped));
  let skipBusy = $state(false);
  let plannedDateBusy = $state(false);

  function sessionExerciseOverride(exerciseName: string): PlannedExercisePlan | null {
    if (!activeSessionPlan) return null;
    const exerciseId = toExerciseId(exerciseName, view.keyMaps);
    return activeSessionPlan.exercisePlans?.[exerciseId] ?? null;
  }

  function sessionSkippedFor(micro: EnrichedMicrocycle, index: 0 | 1): boolean {
    return Boolean(sessionPlanByIndex(micro.plan, index)?.skipped);
  }

  const entryByExercise = $derived(new Map(entriesForSession.map((entry) => [entry.exercise, entry])));
  const protocolSkips = $derived.by(() => {
    if (!mesocycle || !microcycle) return new Map<string, string | null>();
    const map = new Map<string, string | null>();
    for (const exercise of slotExercises) {
      if (sessionExerciseOverride(exercise)?.sets.length) continue;
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
  function isExerciseFullyLogged(exerciseName: string, entry?: WorkoutEntry): boolean {
    const recordedSets = loggedSetsFor(entry);
    if (!recordedSets.length) return false;
    const preview = adjustedPreviewSets(exerciseName);
    if (!preview) return true;
    return recordedSets.length >= preview.sets.length;
  }

  function mobileExerciseProgress(exerciseName: string): {
    completed: number;
    total: number;
    percent: number;
    notDone: boolean;
  } {
    const entry = entryByExercise.get(exerciseName);
    const completed = loggedSetsFor(entry).length;
    const total = adjustedPreviewSets(exerciseName)?.sets.length ?? Math.max(1, completed);
    return {
      completed,
      total,
      percent: Math.min(100, Math.round((completed / total) * 100)),
      notDone: allPlannedSetsFailed(total, completed, failedSetsFor(entry))
    };
  }

  $effect(() => {
    if (!browser || !sessionReady || slotExercises.length === 0) return;
    const sessionKey = `${mesocycle?.plan.id ?? ''}:${microcycle?.plan.id ?? ''}:${activeIndex ?? ''}:${workoutDate}`;
    if (
      mobileFocusSessionKey === sessionKey &&
      mobileFocusExercise &&
      slotExercises.includes(mobileFocusExercise)
    ) {
      return;
    }

    mobileFocusSessionKey = sessionKey;
    mobileFocusExercise =
      slotExercises.find((exercise) => !isExerciseFullyLogged(exercise, entryByExercise.get(exercise))) ??
      slotExercises.at(-1) ??
      null;
  });

  const loggedPlanned = $derived(
    requiredSlotExercises.filter((exercise) =>
      isExerciseFullyLogged(exercise, entryByExercise.get(exercise))
    ).length
  );
  const pendingPlanned = $derived(
    requiredSlotExercises.filter((exercise) => {
      const entry = entryByExercise.get(exercise);
      return !isExerciseFullyLogged(exercise, entry) && Boolean(adjustedPreviewSets(exercise));
    })
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
    return extraEntriesForSession(view.entries, {
      activeMicroSessionId,
      validMicroSessionIds,
      workoutDate,
      slotExercises
    })
      .sort((a, b) => a.exercise.localeCompare(b.exercise, 'ru'));
  });

  function sessionDateForIndex(micro: EnrichedMicrocycle, index: 0 | 1): string | null {
    return index === 0 ? (micro.dayA?.date ?? null) : (micro.dayB?.date ?? null);
  }

  function sessionProgressPercent(
    meso: (typeof mesocycles)[number],
    micro: EnrichedMicrocycle,
    index: 0 | 1
  ): number {
    const exercises = exercisesForMicroSession(meso, view.workoutTemplates, index, view.keyMaps);
    if (!exercises.length) return 0;

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
    if (!required.length) return 100;

    const msId = sessionPlanByIndex(micro.plan, index)?.id ?? null;
    const sessionDate = sessionDateForIndex(micro, index);
    const sessionEntries = plannedEntriesForSession(view.entries, {
      activeMicroSessionId: msId,
      validMicroSessionIds,
      workoutDate: sessionDate ?? '',
      slotExercises: exercises
    });
    const sessionEntryByExercise = new Map(
      sessionEntries.map((entry) => [entry.exercise, entry])
    );

    const logged = required.filter((exercise) => {
      const entry = sessionEntryByExercise.get(exercise);
      if (!entry) return false;
      const planned = plannedSetsForSession(meso, micro, index, exercise);
      return planned ? loggedSetsFor(entry).length >= planned.sets.length : loggedSetsFor(entry).length > 0;
    }).length;

    return Math.round((logged / required.length) * 100);
  }

  function sessionProgressFor(micro: EnrichedMicrocycle, index: 0 | 1): number {
    if (!mesocycle) return 0;
    return sessionProgressPercent(mesocycle, micro, index);
  }

  const planSessionSteps = $derived.by((): SessionRoutingRef[] => {
    const steps: SessionRoutingRef[] = [];
    for (const meso of mesocycles) {
      for (const micro of meso.microcycles) {
        for (const slot of ['A', 'B'] as const) {
          const index = slot === 'B' ? 1 : 0;
          const session = sessionPlanByIndex(micro.plan, index);
          if (!session) continue;
          steps.push({
            id: session.id,
            mesoId: meso.plan.id,
            microId: micro.plan.id,
            slot,
            date: session.date ?? null
          });
        }
      }
    }
    return steps;
  });

  const currentSessionStepIndex = $derived.by(() => {
    if (!sessionReady || !mesocycle || !microcycle || !activeSlot) return -1;
    return planSessionSteps.findIndex(
      (step) =>
        step.mesoId === mesocycle.plan.id &&
        step.microId === microcycle.plan.id &&
        step.slot === activeSlot
    );
  });

  function applySessionStep(step: Pick<SessionRoutingRef, 'mesoId' | 'microId' | 'slot'>) {
    autoPicked = false;
    mesoPick = step.mesoId;
    microPick = step.microId;
    slotPick = step.slot;
    pickerOpen = false;
    const meso = mesocycles.find((item) => item.plan.id === step.mesoId);
    const micro = meso?.microcycles.find((item) => item.plan.id === step.microId);
    if (micro) {
      const planned = sessionDateForIndex(micro, step.slot === 'B' ? 1 : 0);
      datePick = planned ?? todayIso();
    }
  }

  function goSessionStep(delta: -1 | 1) {
    const idx = currentSessionStepIndex;
    if (idx < 0) return;
    const next = planSessionSteps[idx + delta];
    if (next) applySessionStep(next);
  }

  function pickSession(slot: 'A' | 'B') {
    if (!mesocycle || !microcycle) return;
    applySessionStep({ mesoId: mesocycle.plan.id, microId: microcycle.plan.id, slot });
  }

  $effect(() => {
    if (!browser || !sessionReady || pickerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goSessionStep(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goSessionStep(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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

  function entryComments(entry: WorkoutEntry): string[] {
    const session = entry.id ? view.sessions.find((item) => item.id === entry.id) : null;
    return (
      session?.rows
        .map((row) => row.comment?.trim())
        .filter((comment): comment is string => Boolean(comment)) ?? []
    );
  }

  function planStats(sets: ExerciseSet[]) {
    const count = sets.length;
    const totalReps = sets.reduce((sum, [, reps]) => sum + reps, 0);
    const tonnage = sets.reduce((sum, [weight, reps]) => sum + weight * reps, 0);
    const repsList = sets.map(([, reps]) => reps);
    const weightList = sets.map(([weight]) => weight);
    const averageWeight = count
      ? weightList.reduce((sum, weight) => sum + weight, 0) / count
      : 0;
    const uniformReps = repsList.length > 0 && repsList.every((reps) => reps === repsList[0]);
    const uniformWeight = weightList.length > 0 && weightList.every((w) => w === weightList[0]);
    return {
      count,
      totalReps,
      tonnage,
      averageWeight,
      maxWeight: weightList.length ? Math.max(...weightList) : 0,
      uniform: count > 0 && uniformReps && uniformWeight,
      weight: weightList[0] ?? 0,
      reps: repsList[0] ?? 0,
      repScheme: uniformReps ? String(repsList[0]) : null
    };
  }

  function adjustedPreviewSets(
    exerciseName: string
  ): { kind: ExerciseKind; sets: ExerciseSet[] } | null {
    const override = sessionExerciseOverride(exerciseName);
    if (override?.sets.length) {
      return { kind: override.kind, sets: override.sets.map((set) => [...set] as ExerciseSet) };
    }
    if (protocolSkips.has(exerciseName)) return null;
    const input = plannedInput(exerciseName);
    if (!input) return null;
    const sets = suggestPlannedSets(input);
    if (!sets.length) return null;
    return { kind: input.kind, sets };
  }

  function primaryLogRow(entry?: WorkoutEntry): SessionRow | null {
    if (!entry?.id) return null;
    return workoutStore.database.logs.find((item) => item.id === entry.id)?.blocks[0] ?? null;
  }

  function loggedSetsFor(entry?: WorkoutEntry): ExerciseSet[] {
    const row = primaryLogRow(entry);
    return row?.sets ?? entry?.sets ?? [];
  }

  function failedSetsFor(entry?: WorkoutEntry): number[] {
    const row = primaryLogRow(entry);
    return row?.failedSets ?? entry?.failedSets ?? [];
  }

  function completedLoggedSetsFor(entry?: WorkoutEntry): ExerciseSet[] {
	const row = primaryLogRow(entry);
	return row ? completedRowSets(row) : [];
  }

  function plannedSetsForSession(
    meso: (typeof mesocycles)[number],
    micro: EnrichedMicrocycle,
    index: 0 | 1,
    exerciseName: string
  ): { kind: ExerciseKind; sets: ExerciseSet[] } | null {
    const session = sessionPlanByIndex(micro.plan, index);
    const exerciseId = toExerciseId(exerciseName, view.keyMaps);
    const override = session?.exercisePlans?.[exerciseId];
    if (override?.sets.length) {
      return { kind: override.kind, sets: override.sets.map((set) => [...set] as ExerciseSet) };
    }
    const skip = exerciseProtocolSkipOnMicro(
      view.cyclePlanForCalc,
      meso.plan,
      micro.plan,
      exerciseName,
      view.keyMaps
    );
    if (skip.skipped) return null;
    const kind = exerciseKind(exerciseName);
    const protocolId = mesoProtocolId(meso.plan, exerciseName, view.keyMaps) ?? meso.plan.templateId;
    const guide = thesesStore.protocolGuideFor(protocolId);
    const sets = suggestPlannedSets({
      exercise: exerciseName,
      kind,
      date: session?.date ?? todayIso(),
      entries: view.entries,
      anchor1rm: meso.anchorInfo[exerciseName]?.anchor ?? null,
      cyclePlan: view.cyclePlanForCalc,
      meso: meso.plan,
      micro: micro.plan,
      keyMaps: view.keyMaps,
      protocolGuideWeek: protocolGuideWeek(guide?.weeks, micro.plan.indexInMeso),
      volumeGuideRows,
      allowLastWorkoutFallback: Boolean(session?.date)
    });
    return sets.length ? { kind, sets } : null;
  }

  function saveQuickPlanSets(exerciseName: string, kind: ExerciseKind, sets: ExerciseSet[]) {
    if (!mesocycle || !microcycle || activeIndex == null) return;
    if (!usingManualPlan) {
      toasts.error('Сначала откройте и сохраните план в разделе «План».');
      return;
    }
    const basePlan = workoutStore.view.cyclePlanView.plan;
    if (!basePlan) return;
    planQuickBusy = exerciseName;
    error = '';
    try {
      saveCyclePlanState(
        updateSessionExercisePlan(
          basePlan,
          mesocycle.plan.id,
          microcycle.plan.id,
          activeIndex,
          exerciseName,
          { kind, sets },
          view.keyMaps
        )
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось изменить план';
      error = message;
      toasts.error(message);
    } finally {
      planQuickBusy = null;
    }
  }

  function nudgePlannedSetWeight(exerciseName: string, setIndex: number, direction: 1 | -1) {
    const preview = adjustedPreviewSets(exerciseName);
    if (!preview || preview.kind !== 'strength' || !preview.sets[setIndex]) return;
    const sets = preview.sets.map((set) => [...set] as ExerciseSet);
    const [weight, reps] = sets[setIndex];
    const nextWeight = Math.max(WEIGHT_STEP, Math.round((weight + direction * WEIGHT_STEP) * 2) / 2);
    sets[setIndex] = [nextWeight, reps];
    saveQuickPlanSets(exerciseName, preview.kind, sets);
  }

  function pendingActualWeight(exerciseName: string, setIndex: number, plannedWeight: number) {
    return pendingActualWeights[`${exerciseInteractionKey(exerciseName)}:${setIndex}`] ?? plannedWeight;
  }

  function nudgePendingActualWeight(
    exerciseName: string,
    setIndex: number,
    plannedWeight: number,
    direction: 1 | -1
  ) {
    const key = `${exerciseInteractionKey(exerciseName)}:${setIndex}`;
    const currentWeight = pendingActualWeight(exerciseName, setIndex, plannedWeight);
    pendingActualWeights[key] = Math.max(
      WEIGHT_STEP,
      Math.round((currentWeight + direction * WEIGHT_STEP) * 2) / 2
    );
  }

  async function nudgeRecordedSetWeight(exerciseName: string, setIndex: number, direction: 1 | -1) {
    const preview = adjustedPreviewSets(exerciseName);
    const existing = entryByExercise.get(exerciseName);
    const sets = loggedSetsFor(existing).map((set) => [...set] as ExerciseSet);
    if (!preview || preview.kind !== 'strength' || !existing?.id || !sets[setIndex]) return;
    const [weight, reps] = sets[setIndex];
    const nextWeight = Math.max(WEIGHT_STEP, Math.round((weight + direction * WEIGHT_STEP) * 2) / 2);
    sets[setIndex] = [nextWeight, reps];
    await saveSetsFor(
      exerciseName,
      preview.kind,
      sets,
      '',
      true,
      existing.id,
      failedSetsFor(existing)
    );
  }

  function addPlannedSet(exerciseName: string) {
    const preview = adjustedPreviewSets(exerciseName);
    if (!preview) return;
    const last = preview.sets.at(-1) ?? fallbackPlanSet(preview.kind);
    const sets = [...preview.sets.map((set) => [...set] as ExerciseSet), [...last] as ExerciseSet];
    saveQuickPlanSets(exerciseName, preview.kind, sets);
  }

  function removeLastPlannedSet(exerciseName: string) {
    const preview = adjustedPreviewSets(exerciseName);
    const recordedCount = loggedSetsFor(entryByExercise.get(exerciseName)).length;
    if (!preview || preview.sets.length <= Math.max(1, recordedCount)) return;
    saveQuickPlanSets(
      exerciseName,
      preview.kind,
      preview.sets.slice(0, -1).map((set) => [...set] as ExerciseSet)
    );
  }

  function fallbackPlanSet(kind: ExerciseKind): ExerciseSet {
    if (kind === 'run') return [20, 8];
    if (kind === 'jumps') return [3, 5];
    return [20, 5];
  }

  function beginPlanEdit(exerciseName: string) {
    if (!mesocycle || !microcycle || activeIndex == null) return;
    if (!usingManualPlan) {
      toasts.error('Сначала откройте и сохраните план в разделе «План».');
      return;
    }
    const kind = exerciseKind(exerciseName);
    const override = sessionExerciseOverride(exerciseName);
    const preview = adjustedPreviewSets(exerciseName);
    const sourceSets = override?.sets ?? preview?.sets ?? [fallbackPlanSet(kind)];
    const sessions = ([0, 1] as const).filter((index) =>
      exercisesForMicroSession(mesocycle, view.workoutTemplates, index, view.keyMaps).includes(exerciseName)
    );
    planDraft = {
      exercise: exerciseName,
      kind,
      sets: sourceSets.map(([first, second]) => [String(first), String(second)]),
      customSets: Boolean(override),
      anchor1rm: String(mesocycle.anchorInfo[exerciseName]?.anchor ?? ''),
      protocolId: mesoProtocolId(mesocycle.plan, exerciseName, view.keyMaps) ?? mesocycle.plan.templateId,
      sessions: sessions.length ? [...sessions] : [activeIndex]
    };
  }

  function patchPlanSet(setIndex: number, valueIndex: 0 | 1, value: string) {
    if (!planDraft) return;
    planDraft.sets[setIndex][valueIndex] = value;
    planDraft.customSets = true;
  }

  function addPlanSet() {
    if (!planDraft) return;
    const last = planDraft.sets.at(-1) ?? fallbackPlanSet(planDraft.kind).map(String) as [string, string];
    planDraft.sets.push([...last]);
    planDraft.customSets = true;
  }

  function removePlanSet(setIndex: number) {
	const recordedSets = planDraft
	  ? loggedSetsFor(entryByExercise.get(planDraft.exercise)).length
	  : 0;
    if (
      !planDraft ||
	  setIndex < recordedSets ||
	  planDraft.sets.length <= Math.max(1, recordedSets)
    ) return;
    planDraft.sets.splice(setIndex, 1);
    planDraft.customSets = true;
  }

  function resetPlanSetsToProtocol() {
    if (!planDraft) return;
	const recordedSets = loggedSetsFor(entryByExercise.get(planDraft.exercise)).length;
    const input = plannedInput(planDraft.exercise);
    const calculated = input ? suggestPlannedSets(input) : [];
    const sets = calculated.length ? calculated : [fallbackPlanSet(planDraft.kind)];
	if (sets.length < recordedSets) {
	  toasts.error(`В записи уже есть подходов: ${recordedSets}. Сначала измените факт.`);
      return;
    }
    planDraft.sets = sets.map(([first, second]) => [String(first), String(second)]);
    planDraft.customSets = false;
  }

  function togglePlanSession(index: 0 | 1) {
    if (!planDraft) return;
    const hasSession = planDraft.sessions.includes(index);
    if (hasSession && planDraft.sessions.length === 1) {
      toasts.error('Упражнение должно остаться хотя бы в одной тренировке A/B.');
      return;
    }
    planDraft.sessions = hasSession
      ? planDraft.sessions.filter((item) => item !== index)
      : [...planDraft.sessions, index].sort();
  }

  function parsedDraftSets(draft: PlanExerciseDraft): ExerciseSet[] | null {
    const sets = draft.sets.map(([first, second]) => [Number(first), Number(second)] as ExerciseSet);
    return sets.every(([first, second]) => Number.isFinite(first) && first > 0 && Number.isFinite(second) && second > 0)
      ? sets
      : null;
  }

  function savePlanEdit() {
    if (!planDraft || !mesocycle || !microcycle || activeIndex == null) return;
    const basePlan = workoutStore.view.cyclePlanView.plan;
    if (!basePlan) {
      toasts.error('Сначала откройте и сохраните план в разделе «План».');
      return;
    }
    const anchor = Number(planDraft.anchor1rm);
    if (planDraft.kind === 'strength' && (!Number.isFinite(anchor) || anchor <= 0)) {
      toasts.error('1ПМ должен быть положительным числом.');
      return;
    }
    const sets = parsedDraftSets(planDraft);
	const recordedSets = loggedSetsFor(entryByExercise.get(planDraft.exercise)).length;
    if (planDraft.customSets && !sets) {
      toasts.error('В каждом подходе должны быть два положительных числа.');
      return;
    }
	if (planDraft.customSets && sets && sets.length < recordedSets) {
	  toasts.error(`Нельзя оставить меньше ${recordedSets} подходов: они уже записаны в факте.`);
      return;
    }

    planEditBusy = true;
    error = '';
    try {
      let next = basePlan;
      if (planDraft.kind === 'strength') {
        next = markAnchorManual(next, mesocycle.plan.id, planDraft.exercise, anchor, view.keyMaps);
        next = updateExerciseProtocol(
          next,
          mesocycle.plan.id,
          planDraft.exercise,
          planDraft.protocolId,
          view.keyMaps
        );
      }
      next = updateExerciseSessions(
        next,
        mesocycle.plan.id,
        planDraft.exercise,
        planDraft.sessions,
        view.keyMaps
      );
      next = updateSessionExercisePlan(
        next,
        mesocycle.plan.id,
        microcycle.plan.id,
        activeIndex,
        planDraft.exercise,
        planDraft.sessions.includes(activeIndex) && planDraft.customSets && sets
          ? { kind: planDraft.kind, sets }
          : null,
        view.keyMaps
      );
      saveCyclePlanState(next);
      toasts.success(`План обновлён: ${planDraft.exercise}`);
      planDraft = null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось обновить план';
      error = message;
      toasts.error(message);
    } finally {
      planEditBusy = false;
    }
  }

  function removePlannedExercise() {
    if (!planDraft || !mesocycle) return;
    if (browser && !window.confirm(`Убрать «${planDraft.exercise}» из текущего мезоцикла? История останется.`)) return;
    const basePlan = workoutStore.view.cyclePlanView.plan;
    if (!basePlan) return;
    try {
      saveCyclePlanState(removeExerciseFromMeso(basePlan, mesocycle.plan.id, planDraft.exercise, view.keyMaps));
      toasts.success('Упражнение убрано из плана. История не изменена.');
      planDraft = null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось изменить план';
      error = message;
      toasts.error(message);
    }
  }

  async function saveSetsFor(
    exerciseName: string,
    kind: ExerciseKind,
    sets: ExerciseSet[],
    successMessage: string,
    silent = false,
    existingId?: string,
    failedSets?: number[]
  ) {
    if (!mesocycle || !microcycle || activeIndex == null) return;
    busyId = exerciseName;
    error = '';
    try {
      const existingLog = existingId
        ? workoutStore.database.logs.find((item) => item.id === existingId)
        : undefined;
      const existingRow = existingLog?.blocks[0];
      const normalizedFailedSets = failedSets ?? existingRow?.failedSets ?? [];
      const row: SessionRow = {
        kind,
        sets,
        comment: existingRow?.comment ?? null,
        ...(normalizedFailedSets.length ? { failedSets: normalizedFailedSets } : {})
      };
      await saveExerciseLog({
        exerciseName,
        date: workoutDate,
        rows: [row, ...(existingLog?.blocks.slice(1) ?? [])],
        id: existingId ?? randomUuid(),
        context: {
          mesoId: mesocycle.plan.id,
          microId: microcycle.plan.id,
          indexInMicro: activeIndex
        }
      });
      if (!silent) toasts.success(successMessage);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось сохранить';
      error = message;
      toasts.error(message);
    } finally {
      busyId = null;
    }
  }

  function currentPlanDraftRecordedSets(): number {
    return planDraft ? loggedSetsFor(entryByExercise.get(planDraft.exercise)).length : 0;
  }

  async function markExerciseNotDone(exerciseName: string) {
    if (busyId !== null || protocolSkips.has(exerciseName)) return;
    const preview = adjustedPreviewSets(exerciseName);
    if (!preview?.sets.length) return;
    const existing = entryByExercise.get(exerciseName);
    const storedLog = existing?.id
      ? workoutStore.database.logs.find((item) => item.id === existing.id)
      : undefined;
    const recordedSets = loggedSetsFor(existing);

    if (storedLog && storedLog.blocks.length > 1) {
      focusMobileExercise(exerciseName);
      toasts.error('В упражнении есть дополнительные блоки. Отметьте подходы внутри карточки.');
      return;
    }
    if (completedLoggedSetsFor(existing).length > 0) {
      focusMobileExercise(exerciseName);
      toasts.info('Есть выполненные подходы. Отметьте оставшиеся крестиками внутри упражнения.');
      return;
    }
    if (recordedSets.length > preview.sets.length) {
      focusMobileExercise(exerciseName);
      toasts.error('В записи больше подходов, чем в плане. Измените её внутри карточки.');
      return;
    }

    const sets = preview.sets.map((plannedSet, index) => [
      ...(recordedSets[index] ?? plannedSet)
    ] as ExerciseSet);
    await saveSetsFor(
      exerciseName,
      preview.kind,
      sets,
      '',
      true,
      existing?.id,
      sets.map((_, index) => index)
    );
    if (!error) {
      if (browser && 'vibrate' in navigator) navigator.vibrate(35);
      toasts.info(`Не выполнено: ${exerciseName}`);
    }
  }

  async function restoreExerciseNotDone(exerciseName: string) {
    if (busyId !== null) return;
    const existing = entryByExercise.get(exerciseName);
    if (!existing?.id || !mobileExerciseProgress(exerciseName).notDone) return;
    const storedLog = workoutStore.database.logs.find((item) => item.id === existing.id);
    const row = storedLog?.blocks[0];

    focusMobileExercise(exerciseName, 'auto');
    if (!storedLog || storedLog.blocks.length !== 1 || row?.comment?.trim()) {
      toasts.error('В записи есть комментарий или дополнительные данные. Восстановите её через редактор.');
      return;
    }

    busyId = exerciseName;
    error = '';
    try {
      await deleteSession(existing.id);
      toasts.success(`Возвращено в тренировку: ${exerciseName}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось вернуть упражнение';
      error = message;
      toasts.error(message);
    } finally {
      busyId = null;
    }
  }

  async function confirmSet(exerciseName: string, setIndex: number, failed = false) {
    undoNotice = null;
    if (protocolSkips.has(exerciseName)) return;
    const preview = adjustedPreviewSets(exerciseName);
    if (!preview) return;
    const existing = entryByExercise.get(exerciseName);
    const recordedSets = loggedSetsFor(existing).map((set) => [...set] as ExerciseSet);
    if (setIndex > recordedSets.length || !preview.sets[setIndex]) return;
    if (setIndex === recordedSets.length) {
      const plannedSet = preview.sets[setIndex];
      const actualSet: ExerciseSet = preview.kind === 'strength'
        ? [pendingActualWeight(exerciseName, setIndex, plannedSet[0]), plannedSet[1]]
        : [...plannedSet] as ExerciseSet;
      recordedSets.push(actualSet);
    }
    const nextFailedSets = new Set(
      failedSetsFor(existing).filter((index) => index >= 0 && index < recordedSets.length)
    );
    if (failed) nextFailedSets.add(setIndex);
    else nextFailedSets.delete(setIndex);
    const doneAll = recordedSets.length >= preview.sets.length;
    const message = doneAll
      ? `Записано: ${exerciseName}`
      : `${failed ? 'Не выполнен' : 'Подход'} ${setIndex + 1} · ${exerciseName}`;
    await saveSetsFor(
      exerciseName,
      preview.kind,
      recordedSets,
      message,
      true,
      existing?.id,
      [...nextFailedSets].sort((a, b) => a - b)
    );
    if (!error) {
      delete pendingActualWeights[`${exerciseInteractionKey(exerciseName)}:${setIndex}`];
    }
  }

  async function undoRecordedSet(exerciseName: string, setIndex: number) {
    const preview = adjustedPreviewSets(exerciseName);
    const existing = entryByExercise.get(exerciseName);
    if (!preview || !existing?.id) return;
    const recordedSets = loggedSetsFor(existing).map((set) => [...set] as ExerciseSet);
    if (setIndex < 0 || setIndex >= recordedSets.length) return;

    recordedSets.splice(setIndex, 1);
    const nextFailedSets = failedSetsFor(existing)
      .filter((index) => index !== setIndex)
      .map((index) => (index > setIndex ? index - 1 : index));

    if (recordedSets.length) {
      await saveSetsFor(
        exerciseName,
        preview.kind,
        recordedSets,
        '',
        true,
        existing.id,
        nextFailedSets
      );
      if (!error) {
        undoNotice = {
          key: exerciseInteractionKey(exerciseName),
          setNumber: setIndex + 1
        };
      }
      return;
    }

    busyId = exerciseName;
    error = '';
    try {
      await deleteSession(existing.id);
      undoNotice = {
        key: exerciseInteractionKey(exerciseName),
        setNumber: setIndex + 1
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось отменить подход';
      error = message;
      toasts.error(message);
    } finally {
      busyId = null;
    }
  }

  async function repeatRecordedSetAction(exerciseName: string, setIndex: number, failed: boolean) {
    const isMobile = browser && window.matchMedia('(max-width: 680px)').matches;
    if (recordedSetRepeatAction(isMobile, failed) === 'fail') {
      await confirmSet(exerciseName, setIndex, true);
      return;
    }
    await undoRecordedSet(exerciseName, setIndex);
  }

  async function confirmPlanned(exerciseName: string) {
    undoNotice = null;
    if (protocolSkips.has(exerciseName)) return;
    const preview = adjustedPreviewSets(exerciseName);
    if (!preview) return;
    const existing = entryByExercise.get(exerciseName);
    await saveSetsFor(
      exerciseName,
      preview.kind,
      preview.sets,
      `Записано: ${exerciseName}`,
      false,
      existing?.id,
      failedSetsFor(existing)
    );
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
        const preview = adjustedPreviewSets(exerciseName);
        if (!preview?.sets.length) continue;
        await saveSetsFor(
          exerciseName,
          preview.kind,
          preview.sets,
          '',
          true,
          entryByExercise.get(exerciseName)?.id,
          failedSetsFor(entryByExercise.get(exerciseName))
        );
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
    return { progress: sessionProgressPercent(meso, micro, index), hasExercises: true };
  }

  function daysFromToday(date: string): number {
    const day = 86_400_000;
    return Math.round((Date.parse(date) - Date.parse(todayIso())) / day);
  }

  // «Ближайшая незаполненная»: среди всех сессий плана с упражнениями и прогрессом < 100%
  // берём ту, что ближе всего к сегодня по дате; сессии без даты — по порядку плана, в конце.
  function findNearestIncomplete(): { mesoId: string; microId: string; slot: 'A' | 'B' } | null {
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

  function findCurrentMesoSession(): SessionRoutingRef | null {
    return preferredSessionInLatestMeso(planSessionSteps, (step) => {
      const meso = mesocycles.find((item) => item.plan.id === step.mesoId);
      const micro = meso?.microcycles.find((item) => item.plan.id === step.microId);
      if (!meso || !micro) return false;
      const index = step.slot === 'B' ? 1 : 0;
      if (sessionSkippedFor(micro, index)) return false;
      const { progress, hasExercises } = sessionProgressOf(meso, micro, index);
      return hasExercises && progress < 100;
    });
  }

  let autoSelected = $state(false);
  let autoPicked = $state(false);
  let appliedUrlDate = $state<string | null>(null);

  $effect(() => {
    if (!workoutStore.bootstrapped) return;

    if (urlDate && urlDate !== appliedUrlDate) {
      appliedUrlDate = urlDate;
      datePick = urlDate;
      const resolved = resolveMesoMicroSelection(
        mesocycles,
        urlDate,
        urlMeso,
        urlMicro
      );
      if (resolved) {
        mesoPick = resolved.meso.plan.id;
        microPick = resolved.micro.plan.id;
        if (urlSession !== null) {
          slotPick = urlSession === 1 ? 'B' : 'A';
        } else {
          const index = suggestSessionIndex(
            resolved.micro,
            urlDate,
            view.entries,
            view.workoutTemplates
          ) as 0 | 1;
          slotPick = index === 1 ? 'B' : 'A';
        }
      }
      autoPicked = false;
      autoSelected = true;
      return;
    }

    if (!urlDate) appliedUrlDate = null;

    if (autoSelected) return;
    // Уважаем явный выбор: через URL (со страницы «План») или вручную кликом.
    if (urlMeso || urlMicro || urlSession !== null || mesoPick || microPick || slotPick) {
      autoSelected = true;
      return;
    }
    if (!mesocycles.length) {
      autoSelected = true;
      return;
    }
    const pick =
      findCurrentMesoSession() ??
      preferredSessionForDate(planSessionSteps, view.entries, todayIso()) ??
      findNearestIncomplete();
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

  async function changePlannedSessionDate(nextDate: string) {
    if (!nextDate || !mesocycle || !microcycle || activeIndex == null) return;
    if (nextDate === plannedSessionDate) return;
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
    plannedDateBusy = true;
    error = '';
    try {
      saveCyclePlanState(assignSessionDate(basePlan, mesoId, microId, nextDate, idx));
      datePick = nextDate;
      if (browser && urlDate) {
        const nextUrl = new URL(page.url);
        nextUrl.searchParams.set('date', nextDate);
        await goto(nextUrl, { replaceState: true, noScroll: true, keepFocus: true });
      }
      toasts.success(`Дата тренировки изменена: ${formatDateRu(nextDate)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось изменить дату тренировки';
      error = message;
      toasts.error(message);
    } finally {
      plannedDateBusy = false;
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
      <span class="average-weight">ср. вес {fmtNum(st.averageWeight)} кг</span>
      <span>Σ {st.totalReps} повт</span>
      <span>объём {fmtNum(st.tonnage)} кг</span>
    </p>
  {/if}
{/snippet}

{#snippet setDoneButton(exercise: string, setIndex: number, done: boolean, failed: boolean, disabled: boolean, locked: boolean)}
  <div class="set-action-pair">
    {#if done}
      <button
        type="button"
        class="set-undo-btn"
        aria-label={failed
          ? `Отменить запись подхода ${setIndex + 1}`
          : `Изменить статус подхода ${setIndex + 1}`}
        {disabled}
        title={failed ? 'Отменить запись подхода' : 'Изменить статус подхода'}
        onclick={() => repeatRecordedSetAction(exercise, setIndex, failed)}
      >
        <span class="set-action-icon">
          {#if disabled}
            …
          {:else if failed}
            <IconX size={18} stroke={3} aria-hidden="true" />
          {:else}
            <IconCheck size={18} stroke={3} aria-hidden="true" />
          {/if}
        </span>
        <span class="set-action-label">{failed ? 'Отменить' : 'Не сделал'}</span>
      </button>
    {:else}
      <button
        type="button"
        class="set-done-btn"
        aria-label="Записать подход {setIndex + 1}"
        disabled={disabled || locked}
        title={locked ? 'Сначала отметьте предыдущий подход' : 'Записать подход'}
        onclick={() => confirmSet(exercise, setIndex)}
      >
        <span class="set-action-icon">
          {#if disabled}
            …
          {:else if locked}
            <IconLock size={17} stroke={2.2} aria-hidden="true" />
          {:else}
            <IconFocus2 size={20} stroke={2.1} aria-hidden="true" />
          {/if}
        </span>
        <span class="set-action-label">{locked ? 'Ждёт' : 'Выполнил'}</span>
      </button>
    {/if}
  </div>
{/snippet}

{#snippet setStepper(exercise: string, setIndex: number, weight: number, disabled: boolean, mode: 'plan' | 'fact' | 'draft')}
  <div
    class="set-stepper"
    class:set-stepper-plan={mode === 'plan'}
    class:set-stepper-fact={mode === 'fact'}
    role="group"
    aria-label="Вес {mode === 'plan' ? 'по плану' : 'по факту'} для подхода {setIndex + 1}"
  >
    <button
      type="button"
      aria-label="Уменьшить вес {mode === 'plan' ? 'по плану' : 'по факту'} на {WEIGHT_STEP} кг"
      {disabled}
      onclick={() => mode === 'fact'
        ? nudgeRecordedSetWeight(exercise, setIndex, -1)
        : mode === 'draft'
          ? nudgePendingActualWeight(exercise, setIndex, weight, -1)
          : nudgePlannedSetWeight(exercise, setIndex, -1)}
    >
      −
    </button>
    <span>{fmtNum(weight)}<small>кг</small></span>
    <button
      type="button"
      aria-label="Увеличить вес {mode === 'plan' ? 'по плану' : 'по факту'} на {WEIGHT_STEP} кг"
      {disabled}
      onclick={() => mode === 'fact'
        ? nudgeRecordedSetWeight(exercise, setIndex, 1)
        : mode === 'draft'
          ? nudgePendingActualWeight(exercise, setIndex, weight, 1)
          : nudgePlannedSetWeight(exercise, setIndex, 1)}
    >
      +
    </button>
  </div>
{/snippet}

<div class="container dashboard" class:session-active={sessionReady}>
  <header class="page-header" class:compact={sessionReady}>
    <div>
      <div class="eyebrow">
        {sessionReady ? 'Тренировка' : 'Обзор'}
        {#if autoPicked && sessionReady}
          <span class="auto-badge">авто · ближайшая незаполненная</span>
        {/if}
      </div>
      <h1>
        {#if sessionHeadline}
          {sessionHeadline}
        {:else}
          Выберите тренировку
        {/if}
      </h1>
      <p class="header-lead">
        {#if sessionReady && mesocycle && activeSlot}
          {loggedPlanned}/{requiredSlotExercises.length} упражнений · {mesocycle.plan.label} ·
          {slotLabel(activeSlot)}
        {:else}
          Укажите мезоцикл, микроцикл и сессию A или B — появится план и записи по этому дню.
        {/if}
      </p>
    </div>
  </header>

  {#if !workoutStore.bootstrapped}
    <section class="card empty-state onboarding" aria-busy="true">
      <div class="eyebrow">Загрузка</div>
      <h2>Собираю текущую тренировку</h2>
      <p>
        Подтягиваю журнал, план и ближайшую незаполненную сессию. После загрузки здесь появится
        следующий рабочий шаг.
      </p>
    </section>
  {:else if mesocycles.length === 0}
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
      {#if sessionReady && mesocycle && microcycle && activeSlot && !pickerOpen}
        <div
          class="session-deck"
          style={`--meso-color: ${mesocycleColor(mesocycle.index)}; --slot-color: ${slotColor(activeSlot)}`}
        >
          <button
            type="button"
            class="deck-nav"
            aria-label="Предыдущая тренировка"
            disabled={currentSessionStepIndex <= 0}
            onclick={() => goSessionStep(-1)}
          >
            <span aria-hidden="true">‹</span>
          </button>

          <div class="deck-core">
            <header class="deck-head">
              <div class="deck-labels">
                <span class="eyebrow">Контекст тренировки</span>
                {#if planSessionSteps.length > 1}
                  <span class="deck-index">{currentSessionStepIndex + 1} / {planSessionSteps.length}</span>
                {/if}
              </div>
              <h2 class="deck-title">
                <span class="deck-part deck-meso">
                  <span class="deck-title-full">{mesocycle.plan.label}</span>
                  <span class="deck-title-short">М{mesocycle.index}</span>
                </span>
                <span class="deck-sep" aria-hidden="true">·</span>
                <span class="deck-part deck-micro">
                  <span class="deck-title-full">Микроцикл {microcycle.plan.indexInMeso}</span>
                  <span class="deck-title-short">μ{microcycle.plan.indexInMeso}</span>
                </span>
                <span class="deck-sep" aria-hidden="true">·</span>
                <span class="deck-part deck-slot">
                  <span class="deck-title-full">{slotLabel(activeSlot)}</span>
                  <span class="deck-title-short">{activeSlot}</span>
                </span>
              </h2>
              <div class="deck-meta">
                <label class="deck-plan-date" title="Изменить дату этой тренировки в плане">
                  <span>Дата в плане</span>
                  <input
                    type="date"
                    value={plannedSessionDate ?? ''}
                    aria-label="Дата {slotLabel(activeSlot)} в плане"
                    disabled={plannedDateBusy || !usingManualPlan}
                    onchange={(event) => void changePlannedSessionDate(event.currentTarget.value)}
                  />
                </label>
                {#if sessionSkipped}
                  <span class="skip-flag">пропущена</span>
                {/if}
              </div>
            </header>

            <div class="deck-toolbar">
              <div class="slot-segment" role="tablist" aria-label="Сессия A или B">
                {#each ['A', 'B'] as slot (slot)}
                  {@const slotKey = slot as 'A' | 'B'}
                  {@const slotIndex = (slotKey === 'B' ? 1 : 0) as 0 | 1}
                  {@const tabProgress = sessionProgressFor(microcycle, slotIndex)}
                  {@const tabSkipped = sessionSkippedFor(microcycle, slotIndex)}
                  <button
                    type="button"
                    role="tab"
                    class="slot-seg"
                    class:active={activeSlot === slotKey}
                    aria-selected={activeSlot === slotKey}
                    style={`--seg-color: ${slotColor(slotKey)}`}
                    onclick={() => pickSession(slotKey)}
                  >
                    <b>{slot}</b>
                    <span>{tabSkipped ? '—' : `${tabProgress}%`}</span>
                  </button>
                {/each}
              </div>

              <label class="deck-date">
                <span>Запись</span>
                <input
                  type="date"
                  value={workoutDate}
                  oninput={(event) => (datePick = event.currentTarget.value)}
                  list="workout-dates"
                />
              </label>

              <button
                type="button"
                class="button button-ghost deck-change"
                aria-expanded={pickerOpen}
                onclick={() => (pickerOpen = true)}
              >
                Сменить
              </button>

              <div class="deck-edit-actions" aria-label="Редактирование плана">
                <a
                  class="button button-ghost deck-edit"
                  href={planEditorUrl('session')}
                  title="Изменить состав тренировки {activeSlot} в текущем мезоцикле"
                >
                  Изменить {activeSlot}
                </a>
                <a
                  class="button button-ghost deck-edit"
                  href={planEditorUrl('plan')}
                  title="Изменить весь текущий мезоцикл"
                >
                  Изменить план
                </a>
              </div>

              <div class="deck-nav-mobile">
                <button
                  type="button"
                  class="deck-nav-mini"
                  aria-label="Предыдущая тренировка"
                  disabled={currentSessionStepIndex <= 0}
                  onclick={() => goSessionStep(-1)}
                >
                  ‹
                </button>
                <button
                  type="button"
                  class="deck-nav-mini"
                  aria-label="Следующая тренировка"
                  disabled={currentSessionStepIndex < 0 ||
                    currentSessionStepIndex >= planSessionSteps.length - 1}
                  onclick={() => goSessionStep(1)}
                >
                  ›
                </button>
              </div>
            </div>

            {#if !sessionSkipped && requiredSlotExercises.length > 0}
              <div class="deck-progress" aria-hidden="true">
                <div class="deck-progress-track">
                  <div class="deck-progress-fill" style={`width: ${sessionProgress}%`}></div>
                </div>
                <span>{loggedPlanned}/{requiredSlotExercises.length}</span>
              </div>
            {/if}
          </div>

          <div class="deck-ring">
            <div
              class="session-ring"
              class:skipped={sessionSkipped}
              style={`--progress: ${sessionProgress * 3.6}deg`}
            >
              <span>{sessionSkipped ? 'skip' : `${sessionProgress}%`}</span>
            </div>
            <span class="ring-cap">готовность {activeSlot}</span>
          </div>

          <button
            type="button"
            class="deck-nav"
            aria-label="Следующая тренировка"
            disabled={currentSessionStepIndex < 0 ||
              currentSessionStepIndex >= planSessionSteps.length - 1}
            onclick={() => goSessionStep(1)}
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>
      {:else}
        <div
          class="training-top"
          style={sessionReady && mesocycle && activeSlot
            ? `--meso-color: ${mesocycleColor(mesocycle.index)}; --slot-color: ${slotColor(activeSlot)}`
            : undefined}
        >
          <div class="training-top-main">
            <div class="eyebrow">Контекст тренировки</div>
            {#if sessionReady && mesocycle && microcycle && activeSlot}
              <h2 class="deck-title">
                <span class="deck-part deck-meso">{mesocycle.plan.label}</span>
                <span class="deck-sep" aria-hidden="true">·</span>
                <span class="deck-part deck-micro">Микроцикл {microcycle.plan.indexInMeso}</span>
                <span class="deck-sep" aria-hidden="true">·</span>
                <span class="deck-part deck-slot">{slotLabel(activeSlot)}</span>
              </h2>
              <div class="training-plan-meta">
                <label class="deck-plan-date" title="Изменить дату этой тренировки в плане">
                  <span>Дата в плане</span>
                  <input
                    type="date"
                    value={plannedSessionDate ?? ''}
                    aria-label="Дата {slotLabel(activeSlot)} в плане"
                    disabled={plannedDateBusy || !usingManualPlan}
                    onchange={(event) => void changePlannedSessionDate(event.currentTarget.value)}
                  />
                </label>
                {#if sessionSkipped}
                  <span class="skip-flag">пропущена</span>
                {/if}
              </div>
            {:else}
              <h2>{mesocycle?.plan.label ?? 'Выберите мезоцикл'}</h2>
              {#if mesocycle && microcycle}
                <p>Микроцикл {microcycle.plan.indexInMeso} — выберите сессию A или B</p>
              {:else if mesocycle}
                <p>Выберите микроцикл, затем сессию A или B</p>
              {/if}
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
            </div>
          {/if}
        </div>
      {/if}

      <datalist id="workout-dates">
        {#each availableDates as date (date)}
          <option value={date}></option>
        {/each}
      </datalist>

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
              {@const slotKey = slot as 'A' | 'B'}
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
          Выберите мезоцикл, микроцикл и сессию — ниже появится план с целевыми весами. Отмечайте
          подходы по одному (✓) или запишите всё сразу.
        </p>
      </section>
    {:else}
      <div
        class="session-toolbar"
        class:toolbar-complete={!sessionSkipped && sessionProgress === 100}
      >
        <div class="toolbar-main">
          <h2>План {activeSlot}</h2>
          <p class="toolbar-status">
            {#if sessionSkipped}
              Сессия пропущена — не учитывается в незаполненных
            {:else if sessionProgress === 100}
              Все упражнения записаны
            {:else if loggedPlanned > 0}
              Записано {loggedPlanned} из {requiredSlotExercises.length}
            {:else}
              {requiredSlotExercises.length} упражнений · отмечайте подходы по одному или «Записать всё»
            {/if}
          </p>
        </div>
        <div class="toolbar-actions">
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
            Вне плана
          </a>
          {#if !sessionSkipped && sessionProgress === 100}
            <a class="button button-ghost" href="{base}/history">Журнал</a>
            <a class="button button-ghost" href="{base}/stats">Аналитика</a>
          {/if}
        </div>
      </div>

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
      <section
        class="exercise-grid"
        role="group"
        aria-label="Упражнения текущей тренировки"
        ontouchstart={beginMobileExerciseSwipe}
        ontouchend={finishMobileExerciseSwipe}
        ontouchcancel={() => (mobileSwipeStart = null)}
      >
        <nav class="mobile-exercise-nav" aria-label="Упражнения текущей тренировки">
          <div class="mobile-exercise-track" use:scrollMobileExerciseIntoView={mobileFocusExercise}>
            {#each slotExercises as exercise, index (exercise)}
              {@const progress = mobileExerciseProgress(exercise)}
              {@const skipped = protocolSkips.has(exercise) && progress.completed === 0}
              <button
                type="button"
                class="mobile-exercise-tab"
                class:active={mobileFocusExercise === exercise}
                class:complete={progress.percent === 100 && !progress.notDone}
                class:in-progress={progress.completed > 0 && progress.percent < 100}
                class:not-done={progress.notDone}
                class:holding={mobileExerciseHoldTarget === exercise}
                class:skipped
                style={`--exercise-progress: ${progress.percent * 3.6}deg; --exercise-hold-ms: ${MOBILE_EXERCISE_HOLD_MS}ms`}
                aria-label={`${exercise}: ${skipped
                  ? 'пропуск по протоколу'
                  : progress.notDone
                    ? 'не выполнено, нажмите, чтобы вернуть в тренировку'
                    : `${progress.completed} из ${progress.total} подходов, удерживайте полсекунды, чтобы отметить невыполненным`}`}
                aria-current={mobileFocusExercise === exercise ? 'step' : undefined}
                disabled={busyId === exercise}
                onpointerdown={(event) => beginMobileExerciseHold(event, exercise)}
                onpointermove={moveMobileExerciseHold}
                onpointerup={finishMobileExerciseHold}
                onpointercancel={finishMobileExerciseHold}
                ontouchstart={(event) => beginMobileExerciseTouchHold(event, exercise)}
                ontouchmove={moveMobileExerciseTouchHold}
                ontouchend={finishMobileExerciseHold}
                ontouchcancel={finishMobileExerciseHold}
                oncontextmenu={(event) => event.preventDefault()}
                onclick={() => void handleMobileExerciseClick(exercise)}
              >
                <span class="mobile-exercise-ring" aria-hidden="true">
                  <span>{progress.notDone ? '×' : progress.percent === 100 ? '✓' : skipped ? '—' : index + 1}</span>
                </span>
                <span class="mobile-exercise-name">{exercise}</span>
              </button>
            {/each}
          </div>
          <span class="mobile-swipe-hint" aria-hidden="true">свайп — перейти · удержать иконку 0,5 с — не сделал</span>
        </nav>
        {#each slotExercises as exercise, index (exercise)}
          {@const entry = entryByExercise.get(exercise)}
          {@const hint = protocolHints.get(exercise)}
          {@const protocolSkip = protocolSkips.get(exercise)}
          {@const previewSets = adjustedPreviewSets(exercise)}
          {@const fullyLogged = isExerciseFullyLogged(exercise, entry)}
          {@const loggedSets = loggedSetsFor(entry)}
          {@const loggedCount = loggedSets.length}
          {@const failedSetIndexes = failedSetsFor(entry)}
          {@const fullyCompleted = fullyLogged && failedSetIndexes.length === 0}
          {@const comments = entry ? entryComments(entry) : []}
          <article
            class="exercise-item"
            class:mobile-focused={mobileFocusExercise === exercise}
            class:complete={fullyLogged}
            class:performed={fullyCompleted}
            class:in-progress={Boolean(entry) && !fullyLogged}
            class:protocol-skipped={Boolean(protocolSkip) && !entry}
          >
            <div class="exercise-index">
              {#if fullyLogged}
                <IconCheck size={18} stroke={3} aria-hidden="true" />
              {:else if loggedCount > 0 && previewSets}
                {loggedCount}/{previewSets.sets.length}
              {:else if protocolSkip}
                —
              {:else}
                {index + 1}
              {/if}
            </div>
            <div class="exercise-content">
              <div class="exercise-heading">
                <div>
                  <span class="mobile-exercise-eyebrow">Тренировка {activeSlot}</span>
                  <h3>{exercise}</h3>
                  {#if protocolSkip && !entry}
                    <div class="plan-meta protocol-skip">
                      <span class="protocol-skip-badge">Пропускаем в этом μ</span>
                      <span class="protocol-skip-note">По протоколу без силовой нагрузки</span>
                    </div>
                  {:else if hint || previewSets || entry}
                    {@const ps = previewSets ? planStats(previewSets.sets) : null}
                    <div class="plan-meta">
                      {#if hint && ps?.uniform}
                        <div class="rx">
                          <span class="rx-weight">{fmtNum(ps.weight)}<small>кг</small></span>
                          <span class="rx-scheme">{ps.count} × {ps.reps}</span>
                          <span class="target-pct">{hint.targetPct}%<small>1ПМ</small></span>
                        </div>
                      {:else if hint}
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
                        <div class="set-list-heading">
                          <strong>Подходы</strong>
                          <span>{loggedCount} из {previewSets.sets.length} записано · автосохранение</span>
                        </div>
                        {#if previewSets.kind === 'strength'}
                          <div class="mobile-set-columns" aria-hidden="true">
                            <span>План</span>
                            <span>Факт</span>
                            <span></span>
                          </div>
                        {/if}
                        <div class="plan-sets-editable">
                          {#each previewSets.sets as set, setIndex}
                            {@const setDone = setIndex < loggedCount}
                            {@const setFailed = failedSetIndexes.includes(setIndex)}
                            {@const setBusy = busyId === exercise || planQuickBusy === exercise}
                            {@const setLocked = setIndex > loggedCount}
                            {@const displaySet = loggedSets[setIndex] ?? set}
                            <div
                              class="set-row"
                              class:strength-set-row={previewSets.kind === 'strength'}
                              class:set-done={setDone && !setFailed}
                              class:set-failed={setDone && setFailed}
                              class:set-active={!setDone && !setFailed && !setLocked}
                              class:set-locked={!setDone && !setFailed && setLocked}
                            >
                              {#if previewSets.kind === 'strength'}
                                <span class="set-chip">
                                  <em>
                                    <span class="set-number">{setIndex + 1}</span>
                                    {#if setDone && !setFailed}
                                      <span class="set-done-mark" aria-label="Подход выполнен">
                                        <IconCheck size={14} stroke={3} aria-hidden="true" />
                                      </span>
                                    {/if}
                                  </em>{setChipText(previewSets.kind, set)}
                                </span>
                                <div class="set-controls">
                                  <div class="set-weight-control set-weight-control-plan">
                                    <span class="set-source">план · {set[1]} повт</span>
                                    {@render setStepper(exercise, setIndex, set[0], setBusy, 'plan')}
                                  </div>
                                  <div class="set-weight-control set-weight-control-fact">
                                    {#if setDone}
                                      {#if setFailed}
                                        <span class="set-source">факт</span>
                                        <div class="set-stepper-placeholder set-skipped-placeholder">не сделал</div>
                                      {:else}
                                        <span class="set-source">факт · {displaySet[1]} повт</span>
                                        {@render setStepper(exercise, setIndex, displaySet[0], setBusy, 'fact')}
                                      {/if}
                                    {:else}
                                      <span class="set-source">факт</span>
                                      <div class="mobile-fact-draft">
                                        {@render setStepper(
                                          exercise,
                                          setIndex,
                                          pendingActualWeight(exercise, setIndex, set[0]),
                                          setBusy || setLocked,
                                          'draft'
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        class="set-skip-btn"
                                        aria-label="Отметить подход {setIndex + 1} как не выполненный"
                                        disabled={setBusy || setLocked}
                                        title={setLocked ? 'Сначала отметьте предыдущий подход' : 'Подход был в плане, но не выполнен'}
                                        onclick={() => confirmSet(exercise, setIndex, true)}
                                      >
                                        {#if setBusy}
                                          …
                                        {:else}
                                          <span class="set-skip-full">не сделал</span>
                                          <span class="set-skip-short">проп.</span>
                                        {/if}
                                      </button>
                                    {/if}
                                  </div>
                                </div>
                                {@render setDoneButton(exercise, setIndex, setDone, setFailed, setBusy, setLocked)}
                              {:else}
                                <span class="set-chip">
                                  <em>{setIndex + 1}</em>{setChipText(previewSets.kind, displaySet)}
                                </span>
                                <span class="set-source">{setDone ? (setFailed ? 'не выполнен' : 'факт') : 'план'}</span>
                                {@render setDoneButton(exercise, setIndex, setDone, setFailed, setBusy, setLocked)}
                              {/if}
                            </div>
                          {/each}
                        </div>
                        <div class="exercise-progress-state" aria-live="polite">
                          {#if undoNotice?.key === exerciseInteractionKey(exercise)}
                            <div class="exercise-undo-notice">
                              <IconRotate2 size={17} stroke={2.4} aria-hidden="true" />
                              <span>Подход {undoNotice.setNumber} отменён</span>
                              <button
                                type="button"
                                aria-label="Скрыть сообщение об отмене"
                                onclick={() => (undoNotice = null)}
                              >
                                <IconX size={16} stroke={2.4} aria-hidden="true" />
                              </button>
                            </div>
                          {/if}
                          <div class="exercise-set-progress" class:complete={fullyCompleted}>
                            <div class="exercise-set-progress-bar" aria-hidden="true">
                              <span style:width={`${Math.min(100, (loggedCount / previewSets.sets.length) * 100)}%`}></span>
                            </div>
                            <span>{loggedCount} из {previewSets.sets.length} подходов</span>
                          </div>
                          {#if fullyCompleted}
                            <div class="exercise-completion">
                              <img
                                src={`${base}/assets/workout-completion-stamp.png`}
                                alt=""
                                width="136"
                                height="136"
                                aria-hidden="true"
                              />
                              <div class="exercise-completion-band">
                                <strong>{exerciseCompletionPhrase(exercise)}</strong>
                                <span>{loggedCount} из {previewSets.sets.length} подходов</span>
                              </div>
                              <button
                                type="button"
                                class="exercise-next-button"
                                onclick={() => continueToNextExercise(exercise)}
                              >
                                <span>{nextIncompleteExercise(exercise) ? 'Дальше' : 'В журнал'}</span>
                                <IconArrowRight size={20} stroke={2.6} aria-hidden="true" />
                              </button>
                            </div>
                          {:else if loggedCount < previewSets.sets.length}
                            <button
                              type="button"
                              class="exercise-next-button exercise-complete-set-button"
                              disabled={busyId === exercise || planQuickBusy === exercise}
                              onclick={() => confirmSet(exercise, loggedCount)}
                            >
                              <span>Выполнил</span>
                              <IconArrowRight size={20} stroke={2.6} aria-hidden="true" />
                            </button>
                          {/if}
                        </div>
                        <div class="quick-plan-actions">
                          <button
                            type="button"
                            class="quick-plan-add"
                            disabled={planQuickBusy === exercise || busyId === exercise}
                            onclick={() => addPlannedSet(exercise)}
                          >
                            {planQuickBusy === exercise ? 'Сохраняем…' : '+ Подход по плану'}
                          </button>
                          {#if previewSets.sets.length > Math.max(1, loggedCount)}
                            <button
                              type="button"
                              class="quick-plan-remove"
                              disabled={planQuickBusy === exercise || busyId === exercise}
                              onclick={() => removeLastPlannedSet(exercise)}
                            >
                              − Последний из плана
                            </button>
                          {/if}
                          {#if sessionExerciseOverride(exercise)}
                            <span>точный план этой тренировки</span>
                          {/if}
                        </div>
                        {@render specSub(
                          previewSets.kind,
						  loggedCount > 0 ? completedLoggedSetsFor(entry) : previewSets.sets,
                          hint?.anchor1rm ?? null,
                          null,
                          ''
                        )}
                      {:else if entry}
                        <div class="plan-sets">
                          {#each loggedSets as set, setIndex}
                            <span class="set-chip">
                              <em>{setIndex + 1}</em>{setChipText(entry.kind, set)}
                            </span>
                          {/each}
                        </div>
                      {/if}
                      {#if comments.length}
                        <div class="entry-comments">
                          {#each comments as comment}
                            <p>{comment}</p>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  {/if}
                </div>
                <div class="exercise-actions">
                  {#if protocolSkip && !entry}
                    <button class="button button-secondary exercise-plan-action" type="button" onclick={() => beginPlanEdit(exercise)}>
                      <span class="plan-action-full">Изменить план</span>
                      <span class="plan-action-short">План</span>
                    </button>
                  {:else}
                    {#if !fullyLogged && previewSets}
                      <button
                        type="button"
                        class="button button-primary exercise-bulk-action"
                        disabled={busyId === exercise}
                        onclick={() => confirmPlanned(exercise)}
                      >
                        {busyId === exercise ? 'Сохраняем…' : 'Записать все подходы'}
                      </button>
                    {/if}
                    <button class="button button-secondary exercise-plan-action" type="button" onclick={() => beginPlanEdit(exercise)}>
                      <span class="plan-action-full">Изменить план</span>
                      <span class="plan-action-short">План</span>
                    </button>
                    {#if entry}
                      <a class="text-button exercise-record-action" href={addUrl(exercise, entry.id)}>Изменить запись</a>
                      {#if entry.id}
                        <button
                          type="button"
                          class="text-button danger exercise-record-action"
                          disabled={busyId === entry.id}
                          onclick={() => removeEntry(entry.id)}
                        >
                          {busyId === entry.id ? '…' : 'Удалить запись'}
                        </button>
                      {/if}
                    {/if}
                  {/if}
                </div>
              </div>
              {#if planDraft?.exercise === exercise}
                <section class="inline-plan-editor" aria-label="Редактирование плана упражнения">
                  <header class="inline-plan-head">
                    <div>
                      <span class="eyebrow">План · прямо в карточке</span>
                      <h4>{exercise}</h4>
                    </div>
                    <button
                      type="button"
                      class="editor-close"
                      aria-label="Закрыть редактор плана"
                      onclick={() => (planDraft = null)}
                    >×</button>
                  </header>

                  <div class="plan-editor-section">
                    <div class="plan-editor-title">
                      <div>
                        <strong>Подходы этой тренировки</strong>
                        <small>
                          {planDraft.customSets
                            ? 'Точное задание вместо расчёта протокола'
                            : 'Сейчас рассчитываются по протоколу; правка любого поля зафиксирует их'}
                        </small>
                      </div>
                      {#if planDraft.customSets}
                        <button
                          type="button"
                          class="text-button"
                          onclick={resetPlanSetsToProtocol}
                        >Вернуть расчёт по протоколу</button>
                      {/if}
                    </div>
                    <div class="plan-set-editor">
                      {#each planDraft.sets as set, setIndex}
                        <div class="plan-set-inputs">
                          <span>{setIndex + 1}</span>
                          <label>
                            <small>
                              {planDraft.kind === 'strength'
                                ? 'Вес, кг'
                                : planDraft.kind === 'run'
                                  ? 'Минуты'
                                  : 'Подходы'}
                            </small>
                            <input
                              type="number"
                              min="0.1"
                              step={planDraft.kind === 'strength' ? '0.5' : '0.1'}
                              value={set[0]}
                              oninput={(event) => patchPlanSet(setIndex, 0, event.currentTarget.value)}
                            />
                          </label>
                          <label>
                            <small>{planDraft.kind === 'run' ? 'км/ч' : 'Повторы'}</small>
                            <input
                              type="number"
                              min="0.1"
                              step={planDraft.kind === 'run' ? '0.1' : '1'}
                              value={set[1]}
                              oninput={(event) => patchPlanSet(setIndex, 1, event.currentTarget.value)}
                            />
                          </label>
                          <button
                             type="button"
                             class="plan-set-remove"
                             aria-label="Удалить подход {setIndex + 1}"
                             disabled={setIndex < currentPlanDraftRecordedSets() || planDraft.sets.length <= Math.max(1, currentPlanDraftRecordedSets())}
                             title={setIndex < currentPlanDraftRecordedSets()
                               ? 'Этот подход уже есть в записи. Сначала измените факт.'
                               : 'Удалить подход из плана'}
                             onclick={() => removePlanSet(setIndex)}
                          >×</button>
                        </div>
                      {/each}
                    </div>
                    <button type="button" class="button button-ghost plan-add-set" onclick={addPlanSet}>
                      + Подход
                    </button>
                  </div>

                  <div class="plan-editor-section meso-settings">
                    <div class="plan-editor-title">
                      <div>
                        <strong>На весь мезоцикл</strong>
                        <small>Эти параметры влияют и на другие микроциклы текущего мезоцикла</small>
                      </div>
                    </div>
                    <div class="meso-field-grid">
                      {#if planDraft.kind === 'strength'}
                        <label>
                          <span>Якорный 1ПМ, кг</span>
                          <input
                            type="number"
                            min="0.1"
                            step="0.5"
                            bind:value={planDraft.anchor1rm}
                          />
                        </label>
                        <label>
                          <span>Протокол</span>
                          <select bind:value={planDraft.protocolId}>
                            {#each view.protocolTemplates as template (template.id)}
                              <option value={template.id}>{template.name}</option>
                            {/each}
                          </select>
                        </label>
                      {/if}
                      <fieldset>
                        <legend>Тренировки</legend>
                        <div class="session-checks">
                          {#each [0, 1] as sessionIndex}
                            {@const indexValue = sessionIndex as 0 | 1}
                            <label>
                              <input
                                type="checkbox"
                                checked={planDraft.sessions.includes(indexValue)}
                                onchange={() => togglePlanSession(indexValue)}
                              />
                              <span>{indexValue === 0 ? 'A' : 'B'}</span>
                            </label>
                          {/each}
                        </div>
                      </fieldset>
                    </div>
                  </div>

                  <footer class="plan-editor-actions">
                    <button
                      type="button"
                      class="button button-primary"
                      disabled={planEditBusy}
                      onclick={savePlanEdit}
                    >{planEditBusy ? 'Сохраняем…' : 'Сохранить план'}</button>
                    <button type="button" class="button button-ghost" onclick={() => (planDraft = null)}>
                      Отмена
                    </button>
                    <button type="button" class="text-button danger remove-from-plan" onclick={removePlannedExercise}>
                      Убрать из мезоцикла
                    </button>
                  </footer>
                </section>
              {/if}
            </div>
          </article>
        {/each}
      </section>
      {:else}
        <section class="card empty-state">
          <h2>Для этой сессии нет упражнений</h2>
          <p>Добавьте упражнения в мезоцикл или выберите другую сессию.</p>
          <a class="button button-secondary" href={planEditorUrl('session')}>
            Изменить тренировку {activeSlot}
          </a>
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
        {@const comments = entryComments(entry)}
        <article>
          <div>
            <strong>{entry.exercise}</strong>
            <div class="inline-sets">
			  {#each entry.sets as set, setIndex}
				<span class:failed-set={entry.failedSets?.includes(setIndex)}>
				  {entry.failedSets?.includes(setIndex) ? '✗ ' : ''}{setLabel(entry.kind, set)}
				</span>
              {/each}
            </div>
            {#if comments.length}
              <div class="entry-comments compact">
                {#each comments as comment}
                  <p>{comment}</p>
                {/each}
              </div>
            {/if}
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
  .dashboard.session-active {
    padding-bottom: 48px;
  }

  .page-header.compact h1 {
    font-size: clamp(28px, 3.6vw, 44px);
  }

  .header-lead {
    max-width: 56ch;
  }

  .page-header.compact .header-lead {
    margin-bottom: 0;
    color: var(--muted-strong);
    font-family: var(--font-mono);
    font-size: 12px;
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
    padding: 0;
    overflow: hidden;
  }

  .session-deck {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr) auto 56px;
    align-items: stretch;
    background:
      linear-gradient(90deg, color-mix(in srgb, var(--meso-color) 14%, transparent), transparent 28%),
      linear-gradient(180deg, #171a21, #121419);
    border-bottom: 1px solid var(--line);
  }

  .deck-nav {
    display: grid;
    place-items: center;
    padding: 0;
    color: var(--muted-strong);
    background: #0c0e12;
    border: 0;
    border-right: 1px solid var(--line);
    font-family: var(--font-mono);
    font-size: 28px;
    font-weight: 300;
    line-height: 1;
    cursor: pointer;
    transition:
      color 140ms ease,
      background 140ms ease;
  }

  .session-deck .deck-nav:last-child {
    border-right: 0;
    border-left: 1px solid var(--line);
  }

  .deck-nav:hover:not(:disabled) {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, #0c0e12);
  }

  .deck-nav:disabled {
    opacity: 0.22;
    cursor: not-allowed;
  }

  .deck-core {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
    padding: 20px 22px 18px;
  }

  .deck-labels {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .deck-index {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    white-space: nowrap;
  }

  .deck-title {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    margin: 4px 0 0;
    font-size: clamp(1.65rem, 3.2vw, 2.1rem);
    font-weight: 700;
    letter-spacing: 0.02em;
    line-height: 1.05;
    text-transform: uppercase;
  }

  .deck-part.deck-meso {
    color: var(--meso-color, var(--text));
  }

  .deck-part.deck-micro {
    color: var(--meso-color, var(--text));
  }

  .deck-part.deck-slot {
    color: var(--slot-color, var(--accent));
  }

  .deck-sep {
    color: var(--muted);
    font-weight: 400;
    opacity: 0.45;
  }

  .deck-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px 14px;
    margin-top: 8px;
    color: var(--muted-strong);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
  }

  .deck-plan-date {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .deck-plan-date input {
    width: 126px;
    min-height: 0;
    padding: 2px 4px;
    color: var(--muted-strong);
    background: transparent;
    border: 0;
    border-bottom: 1px dashed color-mix(in srgb, var(--muted) 65%, transparent);
    border-radius: 0;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0;
    text-transform: none;
    cursor: pointer;
  }

  .deck-plan-date input:hover,
  .deck-plan-date input:focus-visible {
    color: var(--text);
    border-bottom-color: var(--accent);
    outline: none;
  }

  .deck-plan-date input:disabled {
    cursor: wait;
    opacity: 0.55;
  }

  .training-plan-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
    margin-top: 8px;
  }

  .deck-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 10px 14px;
  }

  .slot-segment {
    display: inline-flex;
    border: 1px solid var(--line);
  }

  .slot-seg {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 72px;
    padding: 8px 12px;
    color: var(--muted-strong);
    background: #0a0c10;
    border: 0;
    border-right: 1px solid var(--line);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition:
      background 120ms ease,
      color 120ms ease;
  }

  .slot-seg:last-child {
    border-right: 0;
  }

  .slot-seg b {
    color: var(--seg-color);
    font-size: 13px;
  }

  .slot-seg.active {
    color: var(--text);
    background: color-mix(in srgb, var(--seg-color) 14%, #111722);
  }

  .deck-date {
    display: grid;
    gap: 5px;
  }

  .deck-date span {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .deck-date input {
    width: 148px;
    padding: 7px 9px;
    color: var(--text);
    background: #0a0c10;
    border: 1px solid var(--line);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .deck-change {
    align-self: flex-end;
    white-space: nowrap;
  }

  .deck-edit-actions {
    display: flex;
    align-self: flex-end;
    gap: 8px;
  }

  .deck-edit {
    white-space: nowrap;
  }

  .deck-nav-mobile {
    display: none;
    gap: 6px;
  }

  .deck-nav-mini {
    display: grid;
    width: 44px;
    height: 36px;
    place-items: center;
    padding: 0;
    color: var(--muted-strong);
    background: #0a0c10;
    border: 1px solid var(--line);
    font-family: var(--font-mono);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
  }

  .deck-nav-mini:hover:not(:disabled) {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 40%, var(--line));
  }

  .deck-nav-mini:disabled {
    opacity: 0.28;
    cursor: not-allowed;
  }

  .deck-progress {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .deck-progress-track {
    flex: 1;
    height: 4px;
    background: #0a0c10;
    border: 1px solid var(--line);
  }

  .deck-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--slot-color), var(--accent));
    transition: width 220ms ease;
  }

  .deck-progress span {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    white-space: nowrap;
  }

  .deck-title-short {
    display: none;
  }

  .deck-ring {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 16px 20px;
    border-left: 1px solid var(--line);
  }

  .session-toolbar {
    position: sticky;
    top: 0;
    z-index: 4;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin: 20px 0 12px;
    padding: 14px 16px;
    background: rgb(11 12 15 / 92%);
    border: 1px solid var(--line);
    border-left: 3px solid var(--hazard);
    backdrop-filter: blur(10px);
  }

  .session-toolbar.toolbar-complete {
    border-left-color: var(--accent);
  }

  .toolbar-main h2 {
    margin: 0;
    font-size: 18px;
    letter-spacing: 0.03em;
  }

  .toolbar-status {
    margin: 4px 0 0;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .toolbar-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
  }

  .training-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    padding: 24px;
    border-bottom: 1px solid var(--line);
  }

  .training-top-main {
    flex: 1;
    min-width: 0;
  }

  .training-top-aside {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .picker-toggle {
    white-space: nowrap;
  }

  .session-ring {
    display: grid;
    width: 76px;
    height: 76px;
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

  .ring-cap {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .training-top h2 {
    margin: 6px 0 6px;
    font-size: 30px;
    letter-spacing: 0.01em;
  }

  .training-top .deck-title {
    margin: 6px 0 4px;
    font-size: clamp(1.65rem, 3.2vw, 2.1rem);
    letter-spacing: 0.02em;
  }

  .training-top p {
    margin: 0;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11.5px;
  }

  .skip-flag {
    color: var(--hazard, #f5a524);
    font-weight: 700;
  }

  .skipped-state {
    border-left: 3px solid var(--hazard, #f5a524);
  }

  .context-picker {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) minmax(180px, 0.7fr);
    gap: 22px;
    padding: 22px 24px 24px;
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

  .exercise-progress-state {
    display: none;
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

  .exercise-item.in-progress .exercise-index {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 50%, var(--line));
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 800;
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

  .mobile-exercise-eyebrow {
    display: none;
  }

  .mobile-exercise-nav {
    display: none;
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

  .plan-sets-editable {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: min(100%, 560px);
    margin-top: 4px;
  }

  .quick-plan-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    margin-top: 2px;
  }

  .quick-plan-add,
  .quick-plan-remove {
    min-height: 36px;
    padding: 6px 10px;
    color: var(--accent);
    background: #0a0c10;
    border: 1px dashed color-mix(in srgb, var(--accent) 45%, var(--line));
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .quick-plan-remove {
    color: var(--muted);
    border-color: var(--line-strong);
  }

  .quick-plan-add:hover:not(:disabled),
  .quick-plan-remove:hover:not(:disabled) {
    color: var(--accent-ink);
    background: var(--accent);
    border-style: solid;
  }

  .quick-plan-add:disabled,
  .quick-plan-remove:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .quick-plan-actions > span {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.04em;
  }

  .set-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .strength-set-row {
    display: grid;
    grid-template-columns: 86px minmax(252px, 1fr) auto;
    align-items: end;
    padding: 7px;
    background: rgb(8 10 13 / 55%);
    border: 1px solid transparent;
  }

  .strength-set-row:hover {
    border-color: var(--line);
  }

  .set-controls {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    min-width: 0;
  }

  .set-weight-control {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .set-weight-control .set-source {
    min-width: 0;
  }

  .set-weight-control-plan .set-source {
    color: var(--muted);
  }

  .mobile-set-columns,
  .mobile-fact-draft {
    display: none;
  }

  .set-list-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .set-list-heading span,
  .set-source {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .set-source {
    min-width: 86px;
  }

  .set-row.set-done .set-source {
    color: var(--accent);
  }

  .set-row.set-failed .set-source {
    color: var(--danger);
  }

  .set-row.set-done .set-weight-control-plan .set-source,
  .set-row.set-failed .set-weight-control-plan .set-source {
    color: var(--muted);
  }

  .set-row.set-done .set-chip {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 40%, var(--line));
  }

  .set-done-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, #0a0c10);
    border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--line));
    cursor: pointer;
    font-size: 14px;
    font-weight: 800;
    line-height: 1;
  }

  .set-done-btn:hover:not(:disabled) {
    color: var(--accent-ink);
    background: var(--accent);
    border-color: var(--accent);
  }

  .set-done-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .set-row.set-failed .set-chip {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 40%, var(--line));
  }

  .set-action-pair {
    display: inline-flex;
    gap: 4px;
  }

  .set-action-label {
    display: none;
  }

  .set-undo-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 8%, #0a0c10);
    border: 1px solid color-mix(in srgb, var(--danger) 45%, var(--line));
    cursor: pointer;
    font-size: 18px;
    font-weight: 800;
    line-height: 1;
  }

  .set-undo-btn:hover:not(:disabled) {
    color: #fff;
    background: var(--danger);
    border-color: var(--danger);
  }

  .set-undo-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .set-stepper {
    display: inline-grid;
    grid-template-columns: 34px minmax(48px, 1fr) 34px;
    align-items: center;
    width: 100%;
    min-width: 0;
    height: 36px;
    border: 1px solid var(--line);
    background: #0a0c10;
  }

  .set-stepper button {
    width: 100%;
    min-width: 0;
    height: 100%;
    color: var(--text);
    background: transparent;
    border: 0;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
  }

  .set-stepper button:hover:not(:disabled) {
    color: var(--accent);
    background: var(--surface-raised);
  }

  .set-stepper button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .set-stepper span {
    min-width: 0;
    padding: 0 4px;
    border-inline: 1px solid var(--line);
    color: var(--accent);
    text-align: center;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;
  }

  .set-stepper span small {
    margin-left: 2px;
    color: var(--muted);
    font-size: 8px;
    font-weight: 600;
  }

  .set-stepper-plan span {
    color: var(--muted-strong);
  }

  .set-row.set-failed .set-stepper-fact span {
    color: var(--danger);
  }

  .set-stepper-placeholder {
    display: grid;
    width: 100%;
    min-width: 0;
    height: 36px;
    place-items: center;
    color: var(--muted);
    background: #0a0c10;
    border: 1px dashed var(--line-strong);
    font-family: var(--font-mono);
    font-size: 8px;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .set-skip-btn {
    display: grid;
    width: 100%;
    min-width: 0;
    height: 36px;
    place-items: center;
    padding: 0 8px;
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 4%, #0a0c10);
    border: 1px dashed color-mix(in srgb, var(--danger) 45%, var(--line));
    font-family: var(--font-mono);
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    cursor: pointer;
    white-space: nowrap;
  }

  .set-skip-btn:hover:not(:disabled) {
    color: #fff;
    background: var(--danger);
    border-color: var(--danger);
    border-style: solid;
  }

  .set-skip-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .set-skip-short {
    display: none;
  }

  .plan-action-short {
    display: none;
  }

  .set-skipped-placeholder {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 8%, #0a0c10);
    border-color: color-mix(in srgb, var(--danger) 55%, var(--line));
    border-style: solid;
    font-weight: 700;
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

  .plan-sets-editable .set-chip {
    flex: 0 0 86px;
    width: 86px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .strength-set-row.set-done .set-chip,
  .strength-set-row.set-failed .set-chip {
    color: var(--muted-strong);
    border-color: var(--line);
  }

  .set-chip em {
    min-width: 12px;
    color: var(--muted);
    font-style: normal;
    font-size: 10px;
    font-weight: 700;
    text-align: center;
  }

  .set-done-mark {
    display: none;
  }

  .exercise-item.complete .set-chip {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 40%, var(--line));
  }

  .entry-comments {
    display: grid;
    gap: 4px;
    margin-top: 4px;
  }

  .entry-comments p {
    margin: 0;
    color: var(--muted-strong);
    font-size: 11px;
    line-height: 1.45;
  }

  .entry-comments.compact {
    margin-top: 8px;
  }

  .entry-comments.compact p {
    font-size: 10px;
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

  .inline-plan-editor {
    display: grid;
    gap: 0;
    margin-top: 18px;
    background: #0d1015;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line));
    border-left: 3px solid var(--accent);
  }

  .inline-plan-head,
  .plan-editor-actions,
  .plan-editor-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
  }

  .inline-plan-head {
    padding: 16px 18px;
    border-bottom: 1px solid var(--line);
  }

  .inline-plan-head h4 {
    margin: 4px 0 0;
    font-size: 16px;
  }

  .editor-close {
    width: 34px;
    height: 34px;
    padding: 0;
    color: var(--muted-strong);
    background: transparent;
    border: 1px solid var(--line);
    cursor: pointer;
    font-size: 20px;
  }

  .plan-editor-section {
    display: grid;
    gap: 12px;
    padding: 16px 18px;
    border-bottom: 1px solid var(--line);
  }

  .plan-editor-title strong,
  .plan-editor-title small {
    display: block;
  }

  .plan-editor-title strong {
    font-size: 12px;
    letter-spacing: 0.03em;
  }

  .plan-editor-title small {
    margin-top: 4px;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 9px;
    line-height: 1.4;
  }

  .plan-set-editor {
    display: grid;
    gap: 7px;
  }

  .plan-set-inputs {
    display: grid;
    grid-template-columns: 30px minmax(90px, 150px) minmax(90px, 150px) 34px;
    align-items: end;
    gap: 8px;
  }

  .plan-set-inputs > span {
    display: grid;
    height: 36px;
    place-items: center;
    color: var(--muted);
    border: 1px solid var(--line);
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .plan-set-inputs label,
  .meso-field-grid > label {
    display: grid;
    gap: 5px;
  }

  .plan-set-inputs small,
  .meso-field-grid label > span,
  .meso-field-grid legend {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .plan-set-inputs input,
  .meso-field-grid input[type='number'],
  .meso-field-grid select {
    min-width: 0;
    height: 36px;
    padding: 7px 9px;
    color: var(--text);
    background: #080a0d;
    border: 1px solid var(--line-strong);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .plan-set-remove {
    width: 34px;
    height: 36px;
    padding: 0;
    color: var(--danger);
    background: transparent;
    border: 1px solid var(--line);
    cursor: pointer;
  }

  .plan-set-remove:disabled {
    opacity: 0.25;
    cursor: not-allowed;
  }

  .plan-add-set {
    justify-self: start;
  }

  .meso-settings {
    background: rgb(255 255 255 / 1.5%);
  }

  .meso-field-grid {
    display: grid;
    grid-template-columns: minmax(130px, 0.7fr) minmax(210px, 1.3fr) auto;
    align-items: end;
    gap: 12px;
  }

  .meso-field-grid fieldset {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .meso-field-grid legend {
    margin-bottom: 5px;
  }

  .session-checks {
    display: flex;
    height: 36px;
  }

  .session-checks label {
    position: relative;
    display: grid;
    width: 46px;
    place-items: center;
    cursor: pointer;
  }

  .session-checks input {
    position: absolute;
    opacity: 0;
  }

  .session-checks span {
    display: grid;
    width: 100%;
    height: 100%;
    place-items: center;
    color: var(--muted);
    background: #080a0d;
    border: 1px solid var(--line-strong);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 800;
  }

  .session-checks label + label span {
    border-left: 0;
  }

  .session-checks input:checked + span {
    color: var(--accent-ink);
    background: var(--accent);
    border-color: var(--accent);
  }

  .plan-editor-actions {
    flex-wrap: wrap;
    justify-content: flex-start;
    padding: 14px 18px;
  }

  .remove-from-plan {
    margin-left: auto;
  }

  .text-button {
    padding: 0;
    color: var(--blue);
    background: transparent;
    border: 0;
    cursor: pointer;
    font-size: 10px;
  }

  .text-button.danger {
    color: var(--danger);
  }

  .inline-sets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

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

  .inline-sets span.failed-set {
	color: #ff8a8a;
	border-color: rgb(255 107 107 / 45%);
	background: rgb(255 107 107 / 9%);
	text-decoration: line-through;
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

  @keyframes completion-enter {
    from {
      opacity: 0;
      transform: scale(0.94);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .exercise-completion {
      animation: none;
    }

    .exercise-set-progress-bar > span {
      transition: none;
    }
  }

  @media (max-width: 1050px) {
    .context-picker {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 680px) {
    .deck-nav-mobile {
      display: flex;
      margin-left: auto;
    }

    .session-deck .deck-nav {
      display: none;
    }

    .deck-ring {
      border-left: 0;
      border-top: 1px solid var(--line);
      padding: 12px 14px;
    }

    .session-deck {
      grid-template-columns: minmax(0, 1fr);
    }

    .deck-core {
      padding: 16px 14px 12px;
    }

    .deck-title {
      font-size: 1.45rem;
    }

    .deck-toolbar {
      flex-direction: column;
      align-items: stretch;
    }

    .deck-date input {
      width: 100%;
    }

    .deck-change {
      width: 100%;
    }

    .deck-edit-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      width: 100%;
    }

    .deck-edit {
      justify-content: center;
    }

    .session-toolbar {
      top: 0;
      flex-direction: column;
      align-items: stretch;
    }

    .toolbar-actions {
      justify-content: stretch;
    }

    .toolbar-actions .button {
      flex: 1 1 auto;
    }

    .training-top {
      flex-direction: column;
      align-items: stretch;
      padding: 18px;
    }

    .training-top-aside {
      justify-content: space-between;
    }

    .exercise-item {
      grid-template-columns: 30px minmax(0, 1fr);
      gap: 10px;
      padding: 14px;
    }

    .set-action-pair {
      gap: 6px;
    }

    .set-done-btn,
    .set-undo-btn,
    .set-stepper {
      height: 44px;
    }

    .set-done-btn,
    .set-undo-btn {
      width: 44px;
    }

    .set-stepper button {
      width: 100%;
    }

    .set-stepper {
      grid-template-columns: 40px minmax(46px, 1fr) 40px;
    }

    .strength-set-row {
      grid-template-columns: 86px minmax(280px, 1fr) auto;
    }

    .set-stepper-placeholder {
      height: 44px;
    }

    .set-skip-btn {
      height: 44px;
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

    .inline-plan-editor {
      margin-left: -40px;
    }

    .plan-editor-title,
    .plan-editor-actions {
      align-items: stretch;
      flex-direction: column;
    }

    .plan-set-inputs {
      grid-template-columns: 28px minmax(0, 1fr) minmax(0, 1fr) 34px;
    }

    .meso-field-grid {
      grid-template-columns: 1fr;
    }

    .plan-editor-actions .button {
      width: 100%;
    }

    .remove-from-plan {
      margin-left: 0;
      align-self: flex-start;
    }

    .day-log article {
      align-items: flex-start;
      flex-direction: column;
    }
  }

  @media (max-width: 520px) {
    .session-deck {
      grid-template-columns: minmax(0, 1fr);
    }

    .deck-core {
      gap: 8px;
      padding: 10px 12px;
    }

    .deck-labels,
    .deck-meta,
    .deck-date,
    .deck-change,
    .deck-edit-actions,
    .deck-ring {
      display: none;
    }

    .deck-title {
      margin: 0;
      font-size: 16px;
    }

    .deck-title-full {
      display: none;
    }

    .deck-title-short {
      display: inline;
    }

    .deck-toolbar {
      flex-direction: row;
      align-items: center;
      gap: 8px;
    }

    .slot-segment {
      flex: 1 1 auto;
    }

    .slot-seg {
      min-height: 38px;
    }

    .deck-nav-mobile {
      flex: 0 0 auto;
      margin-left: 0;
    }

    .deck-nav-mini {
      width: 38px;
      height: 38px;
    }

    .session-toolbar {
      flex-direction: row;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
    }

    .toolbar-main h2 {
      margin: 0;
      font-size: 16px;
    }

    .toolbar-status {
      display: none;
    }

    .toolbar-actions {
      width: auto;
      margin-left: auto;
      justify-content: flex-end;
    }

    .toolbar-actions .button {
      display: none;
    }

    .toolbar-actions .button-primary {
      display: inline-flex;
      flex: 0 0 auto;
      min-height: 34px;
      padding: 0 10px;
      font-size: 9px;
    }

    .exercise-item {
      display: block;
      padding: 12px 10px;
    }

    .exercise-index {
      display: none;
    }

    .exercise-heading {
      position: relative;
      display: block;
    }

    .exercise-heading > div:first-child {
      min-width: 0;
      width: 100%;
    }

    .exercise-heading h3 {
      margin: 2px 0 0;
      padding-right: 54px;
      font-size: 15px;
      line-height: 1.2;
    }

    .exercise-actions {
      position: absolute;
      top: 0;
      right: 0;
      gap: 0;
    }

    .exercise-actions .exercise-bulk-action,
    .exercise-actions .exercise-record-action {
      display: none;
    }

    .exercise-actions .exercise-plan-action {
      min-height: 30px;
      padding: 0 7px;
      color: var(--muted);
      background: transparent;
      border-color: var(--line);
      font-size: 8px;
    }

    .plan-action-full {
      display: none;
    }

    .plan-action-short {
      display: inline;
    }

    .plan-meta {
      gap: 4px;
      margin-top: 6px;
    }

    .plan-meta > .rx,
    .plan-meta > .plan-target,
    .set-list-heading,
    .quick-plan-actions,
    .rx-sub span:not(.average-weight) {
      display: none;
    }

    .rx-sub {
      display: flex;
      margin-top: 6px;
    }

    .rx-sub .average-weight {
      display: inline-flex;
      padding: 4px 7px;
      color: var(--accent);
      background: #0a0c10;
      border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line));
      font-size: 10px;
      font-weight: 700;
    }

    .rx-sub .average-weight::before {
      display: none;
    }

    .protocol-skip-note {
      display: none;
    }

    .plan-sets-editable {
      gap: 4px;
      margin-top: 6px;
    }

    .exercise-progress-state {
      display: grid;
      gap: 10px;
      margin-top: 10px;
    }

    .exercise-set-progress {
      display: grid;
      gap: 7px;
      padding-top: 10px;
      border-top: 1px solid var(--line);
    }

    .exercise-set-progress > span {
      color: var(--muted-strong);
      font-family: var(--font-mono);
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-align: center;
      text-transform: uppercase;
    }

    .exercise-set-progress-bar {
      height: 4px;
      overflow: hidden;
      background: var(--surface-raised);
      border: 1px solid var(--line);
    }

    .exercise-set-progress-bar > span {
      display: block;
      height: 100%;
      background: var(--accent);
      transition: width 180ms ease-out;
    }

    .exercise-undo-notice {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      min-height: 42px;
      padding: 0 10px;
      color: var(--text);
      background: var(--surface-raised);
      border: 1px solid var(--line-strong);
      font-family: var(--font-mono);
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }

    .exercise-undo-notice button {
      display: grid;
      width: 34px;
      height: 34px;
      place-items: center;
      padding: 0;
      color: var(--muted);
      background: transparent;
      border: 0;
      cursor: pointer;
    }

    .exercise-undo-notice button:hover,
    .exercise-undo-notice button:focus-visible {
      color: var(--text);
      background: rgb(255 255 255 / 4%);
      outline: 1px solid var(--line-strong);
    }

    .exercise-completion {
      display: grid;
      justify-items: center;
      gap: 8px;
      padding-top: 2px;
      animation: completion-enter 260ms ease-out both;
    }

    .exercise-completion img {
      display: block;
      width: 136px;
      height: 136px;
      object-fit: contain;
      filter: drop-shadow(0 0 16px rgb(204 255 51 / 10%));
    }

    .exercise-completion-band {
      display: grid;
      width: 100%;
      gap: 2px;
      padding: 12px 10px;
      color: var(--accent-ink);
      background: var(--accent);
      border-inline: 5px solid var(--accent-ink);
      text-align: center;
      text-transform: uppercase;
    }

    .exercise-completion-band strong {
      font-family: var(--font-display);
      font-size: 17px;
      letter-spacing: 0.025em;
      line-height: 1;
    }

    .exercise-completion-band span {
      font-family: var(--font-mono);
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.09em;
    }

    .exercise-next-button {
      display: flex;
      width: 100%;
      min-height: 48px;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 0 14px;
      color: var(--accent-ink);
      background: var(--accent);
      border: 1px solid var(--accent);
      font-family: var(--font-display);
      font-size: 16px;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      cursor: pointer;
    }

    .exercise-next-button:hover,
    .exercise-next-button:focus-visible {
      background: color-mix(in srgb, var(--accent) 86%, white);
      outline: 2px solid rgb(204 255 51 / 24%);
      outline-offset: 2px;
    }

    .exercise-item.performed {
      border-color: color-mix(in srgb, var(--accent) 34%, var(--line));
    }

    .strength-set-row {
      grid-template-columns: 78px minmax(0, 1fr) 48px;
      gap: 6px;
      align-items: center;
      min-height: 54px;
      padding: 4px;
    }

    .strength-set-row > .set-chip {
      grid-column: 1;
      grid-row: 1;
      width: 78px;
      flex-basis: 78px;
      padding-inline: 6px;
      font-size: 11px;
    }

    .strength-set-row > .set-controls {
      grid-column: 2;
      grid-row: 1;
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
    }

    .strength-set-row .set-weight-control-plan {
      display: none;
    }

    .strength-set-row .set-weight-control-fact {
      gap: 0;
    }

    .strength-set-row .set-source {
      display: none;
    }

    .strength-set-row.set-done .set-chip {
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 6%, #0a0c10);
      border-color: color-mix(in srgb, var(--accent) 50%, var(--line));
    }

    .strength-set-row.set-done .set-chip em {
      color: var(--accent);
    }

    .strength-set-row.set-done .set-number {
      display: none;
    }

    .strength-set-row.set-done .set-done-mark {
      display: inline;
    }

    .strength-set-row.set-done .set-stepper-fact {
      border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
    }

    .strength-set-row.set-active {
      background: color-mix(in srgb, var(--accent) 3%, rgb(8 10 13 / 55%));
      border-color: color-mix(in srgb, var(--accent) 30%, var(--line));
    }

    .strength-set-row.set-active .set-action-icon,
    .strength-set-row.set-locked .set-action-icon {
      display: none;
    }

    .strength-set-row.set-active .set-done-btn {
      color: var(--accent-ink);
      background: var(--accent);
      border-color: var(--accent);
    }

    .strength-set-row.set-locked {
      opacity: 0.46;
    }

    .strength-set-row.set-locked .set-done-btn:disabled {
      color: var(--muted);
      background: transparent;
      border-color: var(--line);
      opacity: 1;
    }

    .strength-set-row > .set-action-pair {
      grid-column: 3;
      grid-row: 1;
    }

    .strength-set-row .set-done-btn,
    .strength-set-row .set-undo-btn {
      width: 48px;
      min-width: 48px;
      height: 48px;
      padding: 0;
    }

    .strength-set-row.set-done .set-undo-btn {
      color: var(--accent-ink);
      background: var(--accent);
      border-color: var(--accent);
    }

    .strength-set-row.set-done .set-undo-btn:hover:not(:disabled),
    .strength-set-row.set-done .set-undo-btn:focus-visible {
      color: var(--accent-ink);
      background: color-mix(in srgb, var(--accent) 86%, white);
      border-color: var(--accent);
      outline: 2px solid rgb(204 255 51 / 24%);
      outline-offset: 2px;
    }

    .strength-set-row:not(.set-done):not(.set-failed) > .set-controls {
      grid-column: 3;
    }

    .strength-set-row:not(.set-done):not(.set-failed) > .set-action-pair {
      grid-column: 2;
      width: 100%;
    }

    .strength-set-row:not(.set-done):not(.set-failed) .set-done-btn {
      width: 100%;
      gap: 7px;
    }

    .strength-set-row:not(.set-done):not(.set-failed) .set-action-label {
      display: inline;
      font-family: var(--font-mono);
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .strength-set-row .set-stepper,
    .strength-set-row .set-stepper-placeholder,
    .strength-set-row .set-skip-btn {
      height: 48px;
    }

    .strength-set-row .set-skip-btn {
      padding: 0 2px;
      font-size: 7px;
    }

    .set-skip-full {
      display: none;
    }

    .set-skip-short {
      display: inline;
    }

    .set-action-icon {
      font-size: 16px;
      line-height: 1;
    }

    .set-stepper-placeholder {
      font-size: 7px;
    }

    .inline-plan-editor {
      margin-left: 0;
    }
  }

  @media (max-width: 520px) {
    :global(body) {
      padding-bottom: 0;
      overflow-x: hidden;
    }

    :global(.sidebar) {
      height: 76px;
      padding: 14px 20px 12px;
      background: rgb(9 12 15 / 98%);
      border-bottom-color: var(--line-strong);
    }

    :global(.brand) {
      gap: 11px;
    }

    :global(.brand-mark) {
      width: 42px;
      height: 42px;
      font-size: 13px;
    }

    :global(.brand strong) {
      font-size: 15px;
      line-height: 1;
    }

    :global(.brand small) {
      display: block;
      margin-top: 5px;
      font-size: 7px;
      letter-spacing: 0.13em;
    }

    :global(.profile-switcher),
    :global(.mobile-nav) {
      display: none;
    }

    :global(.mobile-settings) {
      display: grid;
      width: 48px;
      height: 48px;
      place-items: center;
      margin-left: auto;
      padding: 0;
      color: var(--muted-strong);
      background: transparent;
      border: 0;
    }

    :global(.main-content) {
      padding: 0;
    }

    .dashboard.session-active,
    .exercise-grid {
      width: 100%;
      max-width: none;
      min-height: calc(100dvh - 76px);
    }

    .dashboard.session-active {
      padding-bottom: 0;
    }

    .page-header.compact,
    .training-card,
    .session-toolbar,
    .section-heading,
    .day-log {
      display: none;
    }

    .exercise-grid {
      display: block;
      --mobile-exercise-nav-height: 82px;
      background: rgb(9 12 15 / 96%);
    }

    .mobile-exercise-nav {
      position: sticky;
      z-index: 8;
      top: 0;
      display: grid;
      height: var(--mobile-exercise-nav-height);
      align-content: center;
      gap: 3px;
      padding: 7px 0 5px;
      overflow: hidden;
      background: rgb(9 12 15 / 97%);
      border-bottom: 1px solid var(--line-strong);
      box-shadow: 0 8px 18px rgb(0 0 0 / 18%);
    }

    .mobile-exercise-track {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      padding: 0 14px;
      overflow-x: auto;
      overscroll-behavior-x: contain;
      scrollbar-width: none;
    }

    .mobile-exercise-track::-webkit-scrollbar {
      display: none;
    }

    .mobile-exercise-tab {
      display: grid;
      min-width: 58px;
      max-width: 72px;
      flex: 1 0 58px;
      justify-items: center;
      gap: 3px;
      padding: 0;
      color: var(--muted);
      background: transparent;
      border: 0;
      cursor: pointer;
      -webkit-touch-callout: none;
      user-select: none;
    }

    .mobile-exercise-tab:disabled {
      cursor: wait;
      opacity: 0.72;
    }

    .mobile-exercise-ring {
      display: grid;
      width: 34px;
      height: 34px;
      place-items: center;
      padding: 2px;
      background: conic-gradient(
        var(--accent) var(--exercise-progress),
        var(--line-strong) var(--exercise-progress)
      );
      border-radius: 50%;
      touch-action: none;
      transition: box-shadow 160ms ease, transform 140ms ease;
    }

    .mobile-exercise-ring > span {
      display: grid;
      width: 100%;
      height: 100%;
      place-items: center;
      color: var(--muted-strong);
      background: #0b0e11;
      border: 2px solid #0b0e11;
      border-radius: inherit;
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 800;
    }

    .mobile-exercise-name {
      width: 100%;
      overflow: hidden;
      font-family: var(--font-mono);
      font-size: 7px;
      font-weight: 700;
      letter-spacing: 0.02em;
      line-height: 1.05;
      text-align: center;
      text-overflow: ellipsis;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .mobile-exercise-tab.active {
      color: var(--text);
    }

    .mobile-exercise-tab.active .mobile-exercise-ring {
      box-shadow: 0 0 0 2px #0b0e11, 0 0 0 3px var(--accent), 0 0 14px rgb(204 255 51 / 18%);
    }

    .mobile-exercise-tab.active .mobile-exercise-ring > span,
    .mobile-exercise-tab.complete .mobile-exercise-ring > span {
      color: var(--accent);
    }

    .mobile-exercise-tab.skipped .mobile-exercise-ring {
      background: var(--line-strong);
    }

    .mobile-exercise-tab.skipped .mobile-exercise-ring > span {
      color: var(--muted);
    }

    .mobile-exercise-tab.not-done {
      color: color-mix(in srgb, var(--danger) 78%, var(--muted));
    }

    .mobile-exercise-tab.not-done .mobile-exercise-ring {
      background: var(--danger);
      box-shadow: 0 0 12px color-mix(in srgb, var(--danger) 22%, transparent);
    }

    .mobile-exercise-tab.not-done .mobile-exercise-ring > span {
      color: var(--danger);
    }

    .mobile-exercise-tab.not-done.active .mobile-exercise-ring {
      box-shadow:
        0 0 0 2px #0b0e11,
        0 0 0 3px var(--danger),
        0 0 14px color-mix(in srgb, var(--danger) 22%, transparent);
    }

    .mobile-exercise-tab.holding .mobile-exercise-ring {
      box-shadow:
        0 0 0 2px #0b0e11,
        0 0 0 3px var(--hazard),
        0 0 18px color-mix(in srgb, var(--hazard) 28%, transparent);
      transform: scale(0.82);
      transition-duration: var(--exercise-hold-ms);
      transition-timing-function: linear;
    }

    .mobile-exercise-tab.holding .mobile-exercise-name {
      color: var(--hazard);
    }

    .mobile-exercise-tab:focus-visible {
      outline: 1px solid var(--accent);
      outline-offset: 2px;
    }

    .mobile-swipe-hint {
      color: var(--muted);
      font-family: var(--font-mono);
      font-size: 6px;
      font-weight: 700;
      letter-spacing: 0.12em;
      line-height: 1;
      text-align: center;
      text-transform: uppercase;
    }

    .exercise-item:not(.mobile-focused) {
      display: none;
    }

    .exercise-item.mobile-focused {
      position: relative;
      display: block;
      min-height: calc(100dvh - 76px - var(--mobile-exercise-nav-height));
      padding: 20px 22px 18px;
      background: linear-gradient(150deg, rgb(13 17 20 / 98%), rgb(8 11 14 / 99%));
      border: 0;
      border-radius: 0;
      touch-action: pan-y;
    }

    .exercise-item.mobile-focused .exercise-content {
      display: flex;
      min-height: calc(100dvh - 114px - var(--mobile-exercise-nav-height));
      flex-direction: column;
    }

    .exercise-heading {
      position: static;
      display: flex;
      flex-direction: column;
    }

    .exercise-heading > div:first-child {
      display: block;
    }

    .exercise-heading h3 {
      max-width: 100%;
      margin: 7px 0 0;
      padding: 0;
      color: var(--text);
      font-size: clamp(20px, 6vw, 25px);
      line-height: 1.02;
      letter-spacing: 0.01em;
      text-transform: uppercase;
    }

    .mobile-exercise-eyebrow {
      display: block;
      color: var(--accent);
      font-family: var(--font-mono);
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .exercise-actions {
      display: none;
    }

    .plan-meta {
      display: flex;
      flex: none;
      gap: 0;
      margin-top: 10px;
    }

    .plan-meta > .rx {
      display: none;
    }

    .rx-weight,
    .rx-scheme {
      color: #62a9ff;
      background: transparent;
      border: 0;
    }

    .rx-weight {
      font-size: 23px;
    }

    .rx-scheme {
      padding: 0;
      font-size: 19px;
    }

    .target-pct,
    .rx-sub,
    .set-list-heading,
    .quick-plan-actions {
      display: none;
    }

    .plan-sets-editable {
      width: 100%;
      gap: 7px;
      margin-top: 2px;
    }

    .mobile-set-columns {
      display: grid;
      grid-template-columns: minmax(118px, 1.38fr) minmax(94px, 1fr) 48px;
      gap: 8px;
      margin-top: 4px;
      color: var(--muted-strong);
      font-family: var(--font-mono);
      font-size: 8px;
      font-weight: 800;
      letter-spacing: 0.12em;
      line-height: 1;
      text-transform: uppercase;
    }

    .mobile-set-columns span:first-child,
    .mobile-set-columns span:nth-child(2) {
      padding-inline: 10px;
    }

    .strength-set-row {
      grid-template-columns: minmax(118px, 1.38fr) minmax(94px, 1fr) 48px;
      gap: 8px;
      min-height: 56px;
      padding: 3px 0;
      background: transparent;
      border: 0;
    }

    .strength-set-row > .set-chip {
      grid-column: 1;
      grid-row: 1;
      width: 100%;
      min-height: 48px;
      padding-inline: 10px;
      color: var(--text);
      background: rgb(8 11 14 / 78%);
      border-color: var(--line-strong);
      font-size: 12px;
    }

    .strength-set-row > .set-controls,
    .strength-set-row:not(.set-done):not(.set-failed) > .set-controls {
      grid-column: 2;
      grid-row: 1;
      min-width: 0;
    }

    .strength-set-row > .set-action-pair,
    .strength-set-row:not(.set-done):not(.set-failed) > .set-action-pair {
      grid-column: 3;
      grid-row: 1;
      width: 48px;
    }

    .strength-set-row:not(.set-done):not(.set-failed) .set-weight-control-plan {
      display: none;
    }

    .strength-set-row:not(.set-done):not(.set-failed) .set-weight-control-fact {
      display: grid;
    }

    .strength-set-row:not(.set-done):not(.set-failed) .mobile-fact-draft {
      display: block;
    }

    .strength-set-row:not(.set-done):not(.set-failed) .set-skip-btn {
      display: none;
    }

    .strength-set-row .set-stepper {
      grid-template-columns: 30px minmax(40px, 1fr) 30px;
      height: 48px;
    }

    .strength-set-row .set-stepper button {
      width: 30px;
    }

    .strength-set-row .set-stepper span {
      font-size: 10px;
    }

    .strength-set-row .set-done-btn,
    .strength-set-row .set-undo-btn,
    .strength-set-row:not(.set-done):not(.set-failed) .set-done-btn {
      width: 48px;
      min-width: 48px;
      height: 48px;
      padding: 0;
    }

    .strength-set-row.set-active .set-done-btn {
      color: var(--accent);
      background: rgb(8 11 14 / 85%);
      border-color: color-mix(in srgb, var(--accent) 55%, var(--line));
    }

    .strength-set-row.set-locked .set-done-btn:disabled {
      color: var(--muted);
      background: rgb(8 11 14 / 55%);
      border-color: var(--line);
    }

    .strength-set-row.set-locked {
      opacity: 0.68;
    }

    .strength-set-row.set-done .set-chip {
      color: var(--text);
      background: rgb(8 11 14 / 78%);
      border-color: var(--line-strong);
    }

    .strength-set-row.set-done .set-chip em,
    .strength-set-row.set-done .set-number {
      display: inline;
      color: var(--accent);
    }

    .strength-set-row.set-done .set-done-mark {
      display: none;
    }

    .strength-set-row.set-done .set-undo-btn {
      color: var(--accent-ink);
      background: var(--accent);
      border-color: var(--accent);
    }

    .set-action-label {
      display: none !important;
    }

    .exercise-progress-state {
      display: grid;
      gap: 12px;
      margin-top: 12px;
      padding-top: 15px;
    }

    .exercise-set-progress {
      gap: 9px;
      padding-top: 13px;
    }

    .exercise-set-progress.complete {
      display: none;
    }

    .exercise-set-progress-bar {
      height: 5px;
      border: 0;
    }

    .exercise-set-progress > span {
      font-size: 9px;
      letter-spacing: 0.14em;
    }

    .exercise-undo-notice {
      min-height: 48px;
      background: #2a2e35;
      border-color: #343941;
    }

    .exercise-completion {
      position: static;
      gap: 13px;
      padding-top: 0;
      animation: none;
      transform: none;
    }

    .exercise-completion img {
      position: absolute;
      right: 22px;
      bottom: 158px;
      width: 110px;
      height: 110px;
      filter: drop-shadow(0 0 14px rgb(204 255 51 / 14%));
      pointer-events: none;
    }

    .exercise-completion-band {
      position: absolute;
      right: 0;
      bottom: 96px;
      left: 0;
      width: auto;
      margin: 0;
      padding: 14px 10px 12px;
      border-inline-width: 7px;
    }

    .exercise-completion-band strong {
      font-size: 20px;
    }

    .exercise-next-button {
      position: absolute;
      right: 22px;
      bottom: 20px;
      left: 22px;
      width: auto;
      min-height: 56px;
      font-size: 19px;
    }

    .exercise-complete-set-button {
      margin-top: 2px;
    }
  }
</style>
