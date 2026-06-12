<script lang="ts">
	import { base } from '$app/paths';
	import {
		addExerciseToMeso,
		addMicrocycle,
		assignDate,
		compareProtocolMatrixRows,
		emptyCyclePlan,
		markAnchorManual,
		removeMacrocycle,
		removeMesocycle,
		removeMicrocycle,
		removeExerciseFromMeso,
		syncMesoExercises,
		unassignDate,
		updateExerciseProtocol,
		updateMacrocycle,
		updateMesocycle,
		type EnrichedMacrocycle,
		type EnrichedMesocycle,
		type EnrichedMicrocycle,
		type ExerciseAnchorInfo,
		type ProtocolMatrixRow
	} from '$lib/cycle-plan';
	import { mesoProtocolId } from '$lib/exercise-keys';
	import { formatDateRu, fmtNum, todayIso } from '$lib/format';
	import { microDates } from '$lib/micro-plan';
	import { mesocycleColor, sessionIndexColor, sessionIndexLabel } from '$lib/microcycle';
	import {
		createMesocycleFromConstructor,
		defaultMesoStartDate,
		knownMesoExercises,
		mergeConstructorExerciseNames,
		previewMesoPlan,
		resolveExerciseAnchor,
		suggestedMicroCount,
		type MesoExerciseSetup
	} from '$lib/meso-constructor';
	import {
		createMacrocycleFromConstructor,
		defaultMacroStartDate,
		previewMacroPlan,
		type MacroBlockInput
	} from '$lib/macro-constructor';
	import RmLabels from '$lib/components/RmLabels.svelte';
	import {
		importCyclePlanFromAuto,
		saveCyclePlanState,
		workoutStore
	} from '$lib/workout-store';
	import { thesesStore, formatAdaptationStars } from '$lib/training-theses';

	type MesoTab = 'plan' | 'settings';
	type PlanningTab = 'program' | 'methodology';

	type ConstructorRow = {
		enabled: boolean;
		protocolId: string;
		anchor1rm: number;
		manual: boolean;
		anchorSource: string;
	};

	type MacroBlockDraft = {
		id: string;
		label: string;
		microCount: number;
		defaultProtocolId: string;
		selection: Map<string, ConstructorRow>;
	};

	let planningTab = $state<PlanningTab>('program');
	let showMacroConstructor = $state(false);
	let showMesoConstructor = $state(false);
	let mesoTab = $state<MesoTab>('plan');
	let macroPick = $state<string | null>(null);
	let mesoPick = $state<string | null>(null);
	let mesoConstructorMacroId = $state<string | null>(null);
	let macroLabel = $state('Макро 1');
	let macroStart = $state('');
	let macroBlocks = $state<MacroBlockDraft[]>([]);

	let constructorLabel = $state('Новый блок');
	let constructorStart = $state('');
	let constructorMicroCount = $state(4);
	let constructorSelection = $state<Map<string, ConstructorRow>>(new Map());
	let constructorQuery = $state('');
	let constructorAddPick = $state('');
	let mesoAddExercisePick = $state('');

	const view = $derived(workoutStore.view);
	const keyMaps = $derived(view.keyMaps);
	const protocolTemplates = $derived(view.protocolTemplates);
	const workoutTemplates = $derived(view.workoutTemplates);
	const cyclePlanView = $derived(view.cyclePlanView);
	const plan = $derived(cyclePlanView.plan);
	const displayMacros = $derived(cyclePlanView.macrocycles ?? []);
	const displayOrphans = $derived(cyclePlanView.orphanMesocycles ?? []);
	const displayMesos = $derived(cyclePlanView.mesocycles);
	const usingManual = $derived(cyclePlanView.usingManualPlan);
	const unassigned = $derived(cyclePlanView.unassignedDates);
	const hasMethodologyContent = $derived(
		workoutTemplates.length > 0 ||
			protocolTemplates.length > 0 ||
			thesesStore.groups.length > 0 ||
			thesesStore.matrices.length > 0 ||
			thesesStore.volumeGuides.length > 0 ||
			thesesStore.protocolGuides.length > 0
	);

	const selectedMacro = $derived.by((): EnrichedMacrocycle | null => {
		if (displayMacros.length === 0) return null;
		const pick =
			macroPick && displayMacros.some((macro) => macro.plan.id === macroPick)
				? macroPick
				: displayMacros[displayMacros.length - 1].plan.id;
		return displayMacros.find((macro) => macro.plan.id === pick) ?? null;
	});

	const scopedMesos = $derived.by((): EnrichedMesocycle[] => {
		if (selectedMacro) return selectedMacro.mesocycles;
		if (displayMacros.length > 0) return displayOrphans;
		return displayMesos;
	});

	const selectedMeso = $derived.by(() => {
		const mesos = scopedMesos;
		if (mesos.length === 0) return null;
		const pick =
			mesoPick && mesos.some((meso) => meso.plan.id === mesoPick)
				? mesoPick
				: mesos[mesos.length - 1].plan.id;
		return mesos.find((meso) => meso.plan.id === pick) ?? null;
	});

	const nextMicroToLog = $derived.by(() => {
		if (!selectedMeso) return null;
		const micros = selectedMeso.microcycles;
		if (micros.length === 0) return null;
		return micros.find((micro) => !micro.complete) ?? micros[micros.length - 1];
	});

	function todayWorkoutUrl(mesoId: string, microId: string): string {
		const params = new URLSearchParams({
			date: todayIso(),
			meso: mesoId,
			micro: microId
		});
		return `${base}/?${params.toString()}`;
	}

	const knownExercises = $derived(knownMesoExercises(view.entries, workoutTemplates, view.exercises));

	const catalogStrengthExercises = $derived(
		view.exercises
			.filter((exercise) => exercise.kind === 'strength')
			.map((exercise) => exercise.name)
			.sort((a, b) => a.localeCompare(b, 'ru'))
	);

	const constructorExerciseList = $derived(
		mergeConstructorExerciseNames(knownExercises, constructorSelection)
	);

	const filteredConstructorExercises = $derived(
		constructorExerciseList.filter((exercise) => {
			const q = constructorQuery.trim().toLowerCase();
			if (!q) return true;
			return exercise.toLowerCase().includes(q);
		})
	);

	const constructorAddOptions = $derived(
		catalogStrengthExercises.filter((name) => !constructorSelection.has(name))
	);

	const constructorExercises = $derived.by((): MesoExerciseSetup[] =>
		[...constructorSelection.entries()]
			.filter(([, row]) => row.enabled && row.anchor1rm > 0)
			.map(([exercise, row]) => ({
				exercise,
				protocolId: row.protocolId,
				anchor1rm: row.anchor1rm,
				manual: row.manual
			}))
	);

	const constructorPreview = $derived.by(() => {
		if (!plan || !showMesoConstructor || constructorExercises.length === 0) return [];
		return previewMesoPlan(
			plan,
			{
				label: constructorLabel,
				startDate: constructorStart || defaultMesoStartDate(view.entries),
				microCount: constructorMicroCount,
				defaultProtocolId: 'submax-effort',
				exercises: constructorExercises
			},
			keyMaps,
			workoutTemplates
		);
	});

	const constructorSuggestedMicros = $derived.by(() => {
		if (!plan || constructorExercises.length === 0) return 4;
		return suggestedMicroCount(plan.templates, constructorExercises);
	});

	const macroBlockInputs = $derived.by((): MacroBlockInput[] =>
		macroBlocks.map((block) => ({
			label: block.label,
			microCount: block.microCount,
			defaultProtocolId: block.defaultProtocolId,
			exercises: exercisesFromSelection(block.selection)
		}))
	);

	const macroBlocksReady = $derived(
		macroBlockInputs.some((block) => block.exercises.length > 0 && block.microCount >= 1)
	);

	const macroPreview = $derived.by(() => {
		if (!plan || !showMacroConstructor || !macroBlocksReady) return [];
		return previewMacroPlan(
			plan,
			{
				label: macroLabel,
				startDate: macroStart || defaultMacroStartDate(view.entries),
				blocks: macroBlockInputs
			},
			keyMaps
		);
	});

	function makeConstructorRow(
		exercise: string,
		start: string,
		seed?: Partial<ConstructorRow> & { defaultProtocolId?: string; defaultEnabled?: boolean }
	): ConstructorRow {
		const resolved = resolveExerciseAnchor(view.entries, exercise, start);
		return {
			enabled: seed?.enabled ?? seed?.defaultEnabled ?? false,
			protocolId: seed?.protocolId ?? seed?.defaultProtocolId ?? 'submax-effort',
			anchor1rm: seed?.manual
				? (seed.anchor1rm ?? 0)
				: (resolved.value ?? seed?.anchor1rm ?? 0),
			manual: seed?.manual ?? false,
			anchorSource: seed?.manual ? 'вручную' : resolved.source
		};
	}

	function exercisesFromSelection(selection: Map<string, ConstructorRow>): MesoExerciseSetup[] {
		return [...selection.entries()]
			.filter(([, row]) => row.enabled && row.anchor1rm > 0)
			.map(([exercise, row]) => ({
				exercise,
				protocolId: row.protocolId,
				anchor1rm: row.anchor1rm,
				manual: row.manual
			}));
	}

	function createBlockSelection(
		defaultProtocolId: string,
		seed?: Map<string, ConstructorRow>
	): Map<string, ConstructorRow> {
		const start = macroStart || defaultMacroStartDate(view.entries);
		const templateExercises = new Set(workoutTemplates.flatMap((item) => item.exercises));
		const next = new Map<string, ConstructorRow>();

		for (const exercise of knownExercises) {
			const seedRow = seed?.get(exercise);
			next.set(
				exercise,
				makeConstructorRow(exercise, start, {
					...seedRow,
					defaultProtocolId: defaultProtocolId,
					defaultEnabled: templateExercises.has(exercise)
				})
			);
		}
		return next;
	}

	function blockExerciseList(selection: Map<string, ConstructorRow>): string[] {
		return mergeConstructorExerciseNames(knownExercises, selection);
	}

	function blockAddOptions(selection: Map<string, ConstructorRow>): string[] {
		return catalogStrengthExercises.filter((name) => !selection.has(name));
	}

	function addExerciseToConstructor(exerciseName: string) {
		const name = exerciseName.trim();
		if (!name || constructorSelection.has(name)) return;
		const start = constructorStart || defaultMesoStartDate(view.entries);
		const next = new Map(constructorSelection);
		next.set(
			name,
			makeConstructorRow(name, start, {
				enabled: true,
				defaultProtocolId: 'submax-effort'
			})
		);
		constructorSelection = next;
		constructorAddPick = '';
	}

	function addExerciseToMacroBlock(blockId: string, exerciseName: string) {
		const name = exerciseName.trim();
		if (!name) return;
		const start = macroStart || defaultMacroStartDate(view.entries);
		macroBlocks = macroBlocks.map((block) => {
			if (block.id !== blockId || block.selection.has(name)) return block;
			const next = new Map(block.selection);
			next.set(
				name,
				makeConstructorRow(name, start, {
					enabled: true,
					defaultProtocolId: block.defaultProtocolId
				})
			);
			return { ...block, selection: next };
		});
	}

	function patchMacroBlockRow(
		blockId: string,
		exercise: string,
		patch: Partial<ConstructorRow>
	) {
		macroBlocks = macroBlocks.map((block) => {
			if (block.id !== blockId) return block;
			const next = new Map(block.selection);
			const current = next.get(exercise);
			if (!current) return block;
			next.set(exercise, { ...current, ...patch });
			return { ...block, selection: next };
		});
	}

	function refreshMacroAnchors(keepManual = true) {
		const start = macroStart || defaultMacroStartDate(view.entries);
		macroBlocks = macroBlocks.map((block) => {
			const next = new Map(block.selection);
			for (const [exercise, row] of next) {
				if (keepManual && row.manual) continue;
				const resolved = resolveExerciseAnchor(view.entries, exercise, start);
				next.set(exercise, {
					...row,
					anchor1rm: resolved.value ?? row.anchor1rm,
					anchorSource: resolved.source,
					manual: false
				});
			}
			return { ...block, selection: next };
		});
	}

	function applyBlockSuggestedMicroCount(blockId: string) {
		if (!plan) return;
		const block = macroBlocks.find((item) => item.id === blockId);
		if (!block) return;
		const exercises = exercisesFromSelection(block.selection);
		if (exercises.length === 0) return;
		patchMacroBlock(blockId, {
			microCount: suggestedMicroCount(plan.templates, exercises)
		});
	}

	function patchConstructorRow(exercise: string, patch: Partial<ConstructorRow>) {
		const next = new Map(constructorSelection);
		const current = next.get(exercise);
		if (!current) return;
		next.set(exercise, { ...current, ...patch });
		constructorSelection = next;
	}

	function refreshConstructorAnchors(keepManual = true) {
		const start = constructorStart || defaultMesoStartDate(view.entries);
		const next = new Map(constructorSelection);
		for (const [exercise, row] of next) {
			if (keepManual && row.manual) continue;
			const resolved = resolveExerciseAnchor(view.entries, exercise, start);
			next.set(exercise, {
				...row,
				anchor1rm: resolved.value ?? row.anchor1rm,
				anchorSource: resolved.source,
				manual: false
			});
		}
		constructorSelection = next;
	}

	function initConstructorSelection() {
		const start = constructorStart || defaultMesoStartDate(view.entries);
		const templateExercises = new Set(workoutTemplates.flatMap((item) => item.exercises));
		const next = new Map<string, ConstructorRow>();

		for (const exercise of knownExercises) {
			next.set(
				exercise,
				makeConstructorRow(exercise, start, {
					defaultProtocolId: 'submax-effort',
					defaultEnabled: templateExercises.has(exercise)
				})
			);
		}
		constructorSelection = next;
		constructorQuery = '';
		constructorAddPick = '';
	}

	function ensurePlanForConstructor(): boolean {
		if (plan) return true;
		importCyclePlanFromAuto();
		if (workoutStore.cyclePlan) return true;
		saveCyclePlanState(emptyCyclePlan());
		return Boolean(workoutStore.cyclePlan);
	}

	function initMacroBlocks() {
		const block1Id = crypto.randomUUID();
		const block1Selection = createBlockSelection('submax-effort');
		macroBlocks = [
			{
				id: block1Id,
				label: 'Блок 1 — накопление',
				microCount: 4,
				defaultProtocolId: 'submax-effort',
				selection: block1Selection
			},
			{
				id: crypto.randomUUID(),
				label: 'Блок 2 — интенсификация',
				microCount: 4,
				defaultProtocolId: 'max-effort',
				selection: createBlockSelection('max-effort', block1Selection)
			}
		];
	}

	function addMacroBlock() {
		const num = macroBlocks.length + 1;
		const last = macroBlocks[macroBlocks.length - 1];
		const defaultProtocolId = 'submax-effort';
		macroBlocks = [
			...macroBlocks,
			{
				id: crypto.randomUUID(),
				label: `Блок ${num}`,
				microCount: last?.microCount ?? 4,
				defaultProtocolId,
				selection: createBlockSelection(defaultProtocolId, last?.selection)
			}
		];
	}

	function removeMacroBlock(id: string) {
		if (macroBlocks.length <= 1) return;
		macroBlocks = macroBlocks.filter((block) => block.id !== id);
	}

	function patchMacroBlock(id: string, patch: Partial<Omit<MacroBlockDraft, 'id'>>) {
		macroBlocks = macroBlocks.map((block) => {
			if (block.id !== id) return block;
			const updated = { ...block, ...patch };
			if (
				patch.defaultProtocolId &&
				patch.defaultProtocolId !== block.defaultProtocolId
			) {
				const next = new Map(block.selection);
				for (const [exercise, row] of next) {
					if (row.protocolId === block.defaultProtocolId) {
						next.set(exercise, { ...row, protocolId: patch.defaultProtocolId });
					}
				}
				updated.selection = next;
			}
			return updated;
		});
	}

	function openMacroConstructor() {
		if (!ensurePlanForConstructor()) return;
		const macroNum = (workoutStore.cyclePlan?.macrocycles.length ?? 0) + 1;
		macroLabel = `Макро ${macroNum}`;
		macroStart = defaultMacroStartDate(view.entries);
		initMacroBlocks();
		showMacroConstructor = true;
	}

	function closeMacroConstructor() {
		showMacroConstructor = false;
	}

	function confirmMacroConstructor() {
		if (!plan || !macroBlocksReady) return;
		const next = createMacrocycleFromConstructor(
			plan,
			{
				label: macroLabel,
				startDate: macroStart || defaultMacroStartDate(view.entries),
				blocks: macroBlockInputs
			},
			keyMaps
		);
		save(next);
		const macro = next.macrocycles[next.macrocycles.length - 1];
		macroPick = macro?.id ?? null;
		mesoPick = macro?.mesoIds[macro.mesoIds.length - 1] ?? null;
		mesoTab = 'plan';
		showMacroConstructor = false;
	}

	function handleRemoveMacro(macroId: string) {
		if (!plan || !confirm('Удалить макроцикл и все его мезо-блоки?')) return;
		save(removeMacrocycle(plan, macroId));
		if (macroPick === macroId) macroPick = null;
	}

	function handleMacroLabel(macro: EnrichedMacrocycle, label: string) {
		if (!plan) return;
		save(updateMacrocycle(plan, macro.plan.id, { label }));
	}

	function openMesoConstructor(macroId: string | null = null) {
		if (!ensurePlanForConstructor()) return;
		mesoConstructorMacroId = macroId;
		const scopeMesos = macroId
			? (plan?.macrocycles.find((macro) => macro.id === macroId)?.mesoIds.length ?? 0)
			: (workoutStore.cyclePlan?.mesocycles.length ?? 0);
		constructorLabel = `Блок ${scopeMesos + 1}`;
		constructorStart = defaultMesoStartDate(view.entries);
		constructorMicroCount = 4;
		initConstructorSelection();
		showMesoConstructor = true;
	}

	function closeMesoConstructor() {
		showMesoConstructor = false;
		mesoConstructorMacroId = null;
	}

	function applySuggestedMicroCount() {
		constructorMicroCount = constructorSuggestedMicros;
	}

	function confirmMesoConstructor() {
		if (!plan || constructorExercises.length === 0) return;
		const next = createMesocycleFromConstructor(
			plan,
			{
				label: constructorLabel,
				startDate: constructorStart || defaultMesoStartDate(view.entries),
				microCount: constructorMicroCount,
				defaultProtocolId: 'submax-effort',
				exercises: constructorExercises,
				macroId: mesoConstructorMacroId ?? undefined
			},
			keyMaps
		);
		save(next);
		const meso = next.mesocycles[next.mesocycles.length - 1];
		if (mesoConstructorMacroId) macroPick = mesoConstructorMacroId;
		mesoPick = meso?.id ?? null;
		mesoTab = 'plan';
		showMesoConstructor = false;
		mesoConstructorMacroId = null;
	}

	function mesoExerciseNames(meso: EnrichedMesocycle): string[] {
		const names = new Set<string>();
		for (const micro of meso.microcycles) {
			for (const day of [micro.dayA, micro.dayB]) {
				if (!day) continue;
				for (const exercise of day.exercises) names.add(exercise);
			}
		}
		return [...names];
	}

	function exerciseTemplateId(meso: EnrichedMesocycle, exercise: string): string {
		return mesoProtocolId(meso.plan, exercise, keyMaps) ?? meso.plan.templateId;
	}

	function anchorSourceLabel(info: ExerciseAnchorInfo): string {
		if (info.manual) return 'вручную';
		if (info.source === 'prior') return 'до старта мезо';
		if (info.source === 'in_meso') return 'первый блок';
		return '';
	}

	function save(next: NonNullable<typeof plan>) {
		saveCyclePlanState(next);
	}

	function handleImport() {
		importCyclePlanFromAuto();
		planningTab = 'program';
		mesoTab = 'settings';
	}

	function handleCreateMeso() {
		openMesoConstructor();
	}

	function handleRemoveMeso(mesoId: string) {
		if (!plan || !confirm('Удалить мезоцикл из плана?')) return;
		save(removeMesocycle(plan, mesoId));
	}

	function handleAddMicro(mesoId: string) {
		if (!plan) return;
		save(addMicrocycle(plan, mesoId));
	}

	function handleRemoveMicro(mesoId: string, microId: string) {
		if (!plan) return;
		save(removeMicrocycle(plan, mesoId, microId));
	}

	function handleAssign(mesoId: string, microId: string, date: string) {
		if (!plan || !date) return;
		save(assignDate(plan, mesoId, microId, date));
	}

	function handleUnassign(date: string) {
		if (!plan) return;
		save(unassignDate(plan, date));
	}

	function handleMesoLabel(meso: EnrichedMesocycle, label: string) {
		if (!plan) return;
		save(updateMesocycle(plan, meso.plan.id, { label }));
	}

	function handleAnchor1rm(meso: EnrichedMesocycle, exercise: string, value: string) {
		if (!plan) return;
		const parsed = Number(value.replace(',', '.'));
		if (!Number.isFinite(parsed) || parsed <= 0) return;
		save(markAnchorManual(plan, meso.plan.id, exercise, parsed, keyMaps));
	}

	function handleSyncExercises(meso: EnrichedMesocycle) {
		if (!plan) return;
		save(
			syncMesoExercises(
				plan,
				meso.plan.id,
				mesoExerciseNames(meso),
				view.entries,
				meso.plan.startDate,
				meso.plan.endDate,
				keyMaps
			)
		);
	}

	function handleExerciseProtocol(meso: EnrichedMesocycle, exercise: string, templateId: string) {
		if (!plan) return;
		save(
			updateExerciseProtocol(
				plan,
				meso.plan.id,
				exercise,
				templateId === meso.plan.templateId ? null : templateId,
				keyMaps
			)
		);
	}

	function handleRemoveExercise(meso: EnrichedMesocycle, exercise: string) {
		if (!plan) return;
		save(removeExerciseFromMeso(plan, meso.plan.id, exercise, keyMaps));
	}

	function handleAddExerciseToMeso(meso: EnrichedMesocycle, exercise: string) {
		if (!plan || !exercise.trim()) return;
		save(addExerciseToMeso(plan, meso.plan.id, exercise.trim(), view.entries, keyMaps));
		mesoAddExercisePick = '';
	}

	function mesoExercisesAvailableToAdd(meso: EnrichedMesocycle): string[] {
		const inMeso = new Set(Object.keys(meso.anchorInfo));
		return catalogStrengthExercises.filter((name) => !inMeso.has(name));
	}

	function shortProtocolName(name: string): string {
		return name.replace('4×микро', '4μ').replace('~80%', '80%');
	}

	function sessionDayDate(micro: EnrichedMicrocycle, sessionIndex: 0 | 1): string | null {
		return sessionIndex === 0 ? (micro.dayA?.date ?? null) : (micro.dayB?.date ?? null);
	}

	function sessionAddUrl(
		mesoId: string,
		microId: string,
		date: string | null,
		sessionIndex: 0 | 1
	): string {
		const params = new URLSearchParams({
			date: date ?? todayIso(),
			meso: mesoId,
			micro: microId,
			session: String(sessionIndex)
		});
		return `${base}/add?${params.toString()}`;
	}

	function sessionColumnTitle(sessionIndex: 0 | 1): string {
		return sessionIndex === 0 ? 'A' : 'B';
	}

	function planMatrixForSession(matrix: ProtocolMatrixRow[], sessionIndex: 0 | 1): ProtocolMatrixRow[] {
		return matrix
			.map((row) => ({
				...row,
				cells: row.cells.filter((cell) => cell.sessionIndex === sessionIndex)
			}))
			.filter((row) => row.cells.some((cell) => cell.applicable))
			.sort(compareProtocolMatrixRows);
	}
</script>

<div class="cycles-page">

{#if showMacroConstructor && plan}
	<div class="constructor-backdrop" role="presentation" onclick={closeMacroConstructor}></div>
	<section class="card macro-constructor" aria-labelledby="macro-constructor-title">
		<div class="constructor-head">
			<div>
				<h3 id="macro-constructor-title">Конструктор макроцикла</h3>
				<p class="muted">
					Макроцикл — цепочка мезо-блоков. У каждого блока свой набор упражнений, метод и число μ.
				</p>
			</div>
			<button type="button" class="btn ghost-link" onclick={closeMacroConstructor}>Закрыть</button>
		</div>

		<div class="constructor-meta">
			<label>
				<span>Название макро</span>
				<input class="field-input" bind:value={macroLabel} />
			</label>
			<label>
				<span>Старт макро</span>
				<input
					class="field-input"
					type="date"
					bind:value={macroStart}
					onchange={() => refreshMacroAnchors(true)}
				/>
			</label>
		</div>

		<div class="macro-blocks">
			<div class="macro-blocks-head">
				<h4>Мезо-блоки в макро</h4>
				<button type="button" class="btn small" onclick={addMacroBlock}>+ Блок</button>
			</div>
			{#each macroBlocks as block, index (block.id)}
				<article class="macro-block-card">
					<div class="macro-block-meta">
						<label>
							<span>Блок {index + 1}</span>
							<input
								class="field-input"
								value={block.label}
								onchange={(e) => patchMacroBlock(block.id, { label: e.currentTarget.value })}
							/>
						</label>
						<label>
							<span>μ</span>
							<input
								class="field-input narrow"
								type="number"
								min="1"
								max="12"
								value={block.microCount}
								onchange={(e) =>
									patchMacroBlock(block.id, { microCount: Number(e.currentTarget.value) || 4 })}
							/>
						</label>
						<button
							type="button"
							class="btn small"
							onclick={() => applyBlockSuggestedMicroCount(block.id)}
						>
							μ по протоколам
						</button>
						<label>
							<span>Метод</span>
							<select
								class="field-input"
								value={block.defaultProtocolId}
								onchange={(e) =>
									patchMacroBlock(block.id, { defaultProtocolId: e.currentTarget.value })}
							>
								{#each protocolTemplates as template (template.id)}
									<option value={template.id}>{template.name}</option>
								{/each}
							</select>
						</label>
						{#if macroBlocks.length > 1}
							<button
								type="button"
								class="btn small danger"
								onclick={() => removeMacroBlock(block.id)}
							>
								Удалить
							</button>
						{/if}
					</div>
					{#if macroPreview[index]}
						<p class="muted macro-block-dates">
							{formatDateRu(macroPreview[index].startDate)} — {formatDateRu(macroPreview[index].endDate)}
							· {macroPreview[index].microCount} μ · {shortProtocolName(macroPreview[index].protocolName)}
							· {exercisesFromSelection(block.selection).length} упр.
						</p>
					{/if}

					<details class="macro-block-exercises" open>
						<summary>Упражнения блока</summary>
						<div class="constructor-add-row">
							<select
								class="field-select"
								onchange={(e) => {
									addExerciseToMacroBlock(block.id, e.currentTarget.value);
									e.currentTarget.value = '';
								}}
							>
								<option value="">+ добавить из каталога</option>
								{#each blockAddOptions(block.selection) as name (name)}
									<option value={name}>{name}</option>
								{/each}
							</select>
							<a class="btn small ghost-link" href="{base}/exercises">Каталог упражнений</a>
						</div>
						<div class="constructor-table-wrap">
							<table class="constructor-table">
								<thead>
									<tr>
										<th></th>
										<th>Упражнение</th>
										<th>Якорный 1ПМ, кг</th>
										<th>Источник</th>
										<th>Метод</th>
									</tr>
								</thead>
								<tbody>
									{#each blockExerciseList(block.selection) as exercise (exercise)}
										{@const row = block.selection.get(exercise)}
										{#if row}
											<tr class:disabled={!row.enabled}>
												<td>
													<input
														type="checkbox"
														checked={row.enabled}
														onchange={(e) =>
															patchMacroBlockRow(block.id, exercise, {
																enabled: e.currentTarget.checked
															})}
													/>
												</td>
												<td>{exercise}</td>
												<td>
													<input
														class="field-input"
														type="number"
														step="0.5"
														value={row.anchor1rm || ''}
														disabled={!row.enabled}
														onchange={(e) => {
															const parsed = Number(e.currentTarget.value.replace(',', '.'));
															if (!Number.isFinite(parsed) || parsed <= 0) return;
															patchMacroBlockRow(block.id, exercise, {
																anchor1rm: parsed,
																manual: true,
																anchorSource: 'вручную'
															});
														}}
													/>
												</td>
												<td class="muted source-cell">{row.anchorSource}</td>
												<td>
													<select
														class="field-select"
														value={row.protocolId}
														disabled={!row.enabled}
														onchange={(e) =>
															patchMacroBlockRow(block.id, exercise, {
																protocolId: e.currentTarget.value
															})}
													>
														{#each plan.templates as tpl (tpl.id)}
															<option value={tpl.id}>{tpl.name}</option>
														{/each}
													</select>
												</td>
											</tr>
										{/if}
									{/each}
								</tbody>
							</table>
						</div>
					</details>
				</article>
			{/each}
		</div>

		{#if macroPreview.length > 0}
			<div class="macro-preview">
				<h4>Предпросмотр макро</h4>
				{#each macroPreview as blockPreview, index}
					<details class="macro-preview-block">
						<summary>
							{blockPreview.label} · μ1–μ{blockPreview.microCount} · {shortProtocolName(blockPreview.protocolName)}
						</summary>
						<div class="matrix-wrap compact">
							<table class="matrix constructor-preview-matrix">
								<thead>
									<tr>
										<th>Упражнение</th>
										<th>Якорь</th>
										{#each blockPreview.matrix[0]?.cells ?? [] as cell}
											<th>μ{cell.microIndex} {sessionColumnTitle(cell.sessionIndex)}</th>
										{/each}
									</tr>
								</thead>
								<tbody>
									{#each blockPreview.matrix as row}
										<tr>
											<td class="ex-name">{row.exercise}</td>
											<td class="rm-cell">
												<RmLabels anchor={row.anchor} stacked />
											</td>
											{#each row.cells as cell}
												<td class="pct" class:na={!cell.applicable}>
													{#if !cell.applicable}
														<span class="fact-empty">—</span>
													{:else if cell.pct != null && cell.targetWeight != null}
														<span class="pct-val">{cell.pct}%</span>
														<small>{fmtNum(cell.targetWeight)} кг</small>
														{#if cell.label}
															<small class="muted phase-label">{cell.label}</small>
														{/if}
													{:else}
														—
													{/if}
												</td>
											{/each}
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</details>
				{/each}
			</div>
		{:else}
			<p class="muted constructor-empty">В каждом блоке отметьте хотя бы одно упражнение с 1ПМ.</p>
		{/if}

		<div class="constructor-actions">
			<button type="button" class="btn" onclick={closeMacroConstructor}>Отмена</button>
			<button
				type="button"
				class="btn primary"
				disabled={!macroBlocksReady || macroBlocks.length === 0}
				onclick={confirmMacroConstructor}
			>
				Создать макроцикл
			</button>
		</div>
	</section>
{/if}

{#if showMesoConstructor && plan}
	<div class="constructor-backdrop" role="presentation" onclick={closeMesoConstructor}></div>
	<section class="card meso-constructor" aria-labelledby="meso-constructor-title">
		<div class="constructor-head">
			<div>
				<h3 id="meso-constructor-title">
					{mesoConstructorMacroId ? 'Добавить мезо в макро' : 'Конструктор мезоцикла'}
				</h3>
				<p class="muted">
					Упражнения берутся из каталога, истории тренировок и шаблонов дней. Выберите движения,
					метод (протокол) и якорный 1ПМ — план % и кг строится автоматически.
				</p>
			</div>
			<div class="constructor-head-actions">
				<a class="btn small ghost-link" href="{base}/exercises">Каталог</a>
				<button type="button" class="btn ghost-link" onclick={closeMesoConstructor}>Закрыть</button>
			</div>
		</div>

		<div class="constructor-meta">
			<label>
				<span>Название блока</span>
				<input class="field-input" bind:value={constructorLabel} />
			</label>
			<label>
				<span>Старт (для якоря 1ПМ)</span>
				<input
					class="field-input"
					type="date"
					bind:value={constructorStart}
					onchange={() => refreshConstructorAnchors(true)}
				/>
			</label>
			<label>
				<span>Микроциклов (μ)</span>
				<input
					class="field-input narrow"
					type="number"
					min="1"
					max="12"
					bind:value={constructorMicroCount}
				/>
			</label>
			<button type="button" class="btn small" onclick={applySuggestedMicroCount}>
				μ = {constructorSuggestedMicros} (по протоколам)
			</button>
		</div>

		<div class="constructor-add-row">
			<label>
				<span>Поиск</span>
				<input class="field-input" bind:value={constructorQuery} placeholder="Фильтр по названию" />
			</label>
			<label>
				<span>Из каталога</span>
				<select
					class="field-select"
					bind:value={constructorAddPick}
					onchange={(e) => addExerciseToConstructor(e.currentTarget.value)}
				>
					<option value="">+ добавить упражнение</option>
					{#each constructorAddOptions as name (name)}
						<option value={name}>{name}</option>
					{/each}
				</select>
			</label>
		</div>

		<div class="constructor-table-wrap">
			<table class="constructor-table">
				<thead>
					<tr>
						<th></th>
						<th>Упражнение</th>
						<th>Якорный 1ПМ, кг</th>
						<th>Источник</th>
						<th>Метод (протокол)</th>
					</tr>
				</thead>
				<tbody>
					{#each filteredConstructorExercises as exercise (exercise)}
						{@const row = constructorSelection.get(exercise)}
						{#if row}
							<tr class:disabled={!row.enabled}>
								<td>
									<input
										type="checkbox"
										checked={row.enabled}
										onchange={(e) =>
											patchConstructorRow(exercise, { enabled: e.currentTarget.checked })}
									/>
								</td>
								<td>{exercise}</td>
								<td>
									<input
										class="field-input"
										type="number"
										step="0.5"
										value={row.anchor1rm || ''}
										disabled={!row.enabled}
										onchange={(e) => {
											const parsed = Number(e.currentTarget.value.replace(',', '.'));
											if (!Number.isFinite(parsed) || parsed <= 0) return;
											patchConstructorRow(exercise, {
												anchor1rm: parsed,
												manual: true,
												anchorSource: 'вручную'
											});
										}}
									/>
								</td>
								<td class="muted source-cell">{row.anchorSource}</td>
								<td>
									<select
										class="field-select"
										value={row.protocolId}
										disabled={!row.enabled}
										onchange={(e) =>
											patchConstructorRow(exercise, { protocolId: e.currentTarget.value })}
									>
										{#each plan.templates as tpl (tpl.id)}
											<option value={tpl.id}>{tpl.name}</option>
										{/each}
									</select>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>

		{#if constructorPreview.length > 0}
			<div class="constructor-preview">
				<h4>Предпросмотр плана</h4>
				<div class="matrix-wrap">
					<table class="matrix constructor-preview-matrix">
						<thead>
							<tr>
								<th>Упражнение</th>
								<th>Якорь</th>
								<th>Метод</th>
								{#each constructorPreview[0]?.cells ?? [] as cell}
									<th>μ{cell.microIndex} {sessionColumnTitle(cell.sessionIndex)}</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each constructorPreview as row}
								<tr>
									<td class="ex-name">{row.exercise}</td>
									<td><RmLabels anchor={row.anchor} stacked /></td>
									<td class="proto-name" title={row.templateName}>{shortProtocolName(row.templateName)}</td>
									{#each row.cells as cell}
										<td class="pct" class:na={!cell.applicable}>
											{#if !cell.applicable}
												<span class="fact-empty">—</span>
											{:else if cell.pct != null && cell.targetWeight != null}
												<span class="pct-val">{cell.pct}%</span>
												<small>{fmtNum(cell.targetWeight)} кг</small>
												{#if cell.label}
													<small class="muted phase-label">{cell.label}</small>
												{/if}
											{:else}
												—
											{/if}
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{:else}
			<p class="muted constructor-empty">Отметьте упражнения и задайте якорный 1ПМ, чтобы увидеть план.</p>
		{/if}

		<div class="constructor-actions">
			<button type="button" class="btn" onclick={closeMesoConstructor}>Отмена</button>
			<button
				type="button"
				class="btn primary"
				disabled={constructorExercises.length === 0}
				onclick={confirmMesoConstructor}
			>
				Создать мезоцикл
			</button>
		</div>
	</section>
{/if}

<!-- 1. Шапка -->
<section class="planning-head">
	<div>
		<div class="eyebrow">Архитектура программы</div>
		<h1>Планирование</h1>
		<p>
			Собирайте макроциклы из последовательных блоков, назначайте методы упражнениям и контролируйте
			прогресс каждого микроцикла. Шаблоны методов — в разделе
			<a href="{base}/protocols">Протоколы</a>.
		</p>
	</div>
	<div class="head-actions">
		<button type="button" class="btn primary" onclick={openMacroConstructor}>Создать макроцикл</button>
		<button type="button" class="btn" onclick={() => openMesoConstructor()}>Добавить мезоцикл</button>
		{#if !usingManual}
			<button type="button" class="btn" onclick={handleImport}>Импорт из авто</button>
		{/if}
	</div>
</section>

<nav class="planning-tabs" aria-label="Разделы планирования">
	<button
		type="button"
		class="planning-tab"
		class:active={planningTab === 'program'}
		onclick={() => (planningTab = 'program')}
	>
		Программа
	</button>
	<button
		type="button"
		class="planning-tab"
		class:active={planningTab === 'methodology'}
		onclick={() => (planningTab = 'methodology')}
	>
		Методика
	</button>
</nav>

{#if planningTab === 'methodology'}
	{#if !hasMethodologyContent}
		<section class="card empty-state">
			<h3>Методика пока не заполнена</h3>
			<p class="muted">
				Здесь появятся шаблоны тренировок A/B, справочники по объёму и описания методов — после
				импорта тренировок или настройки <code>data/training-theses.json</code>.
			</p>
			<a class="btn" href="{base}/protocols">Шаблоны протоколов</a>
		</section>
	{:else}
	<section class="card help-card">
		<h3>Шаблоны тренировок A / B</h3>
		<div class="ab-grid">
			{#each workoutTemplates as template}
				<article class="ab-card" style="--slot-color: {sessionIndexColor(template.indexInMicro)}">
					<span class="slot-badge">{template.indexInMicro === 0 ? 'A' : 'B'}</span>
					<strong>{sessionIndexLabel(template.indexInMicro)}</strong>
					<p class="muted">{template.label}</p>
					<p class="meta">{template.sessions} дней в базе</p>
				</article>
			{/each}
		</div>

		{#if protocolTemplates.length > 0}
			<div class="protocol-catalog">
				<h3>Методы силовой подготовки (протоколы)</h3>
				<p class="muted theses-note">
					Назначаются каждому упражнению во вкладке «Настройки» мезоцикла. Шаблоны %1ПМ редактируются
					в разделе <a href="{base}/protocols">Протоколы</a>.
				</p>
			</div>
		{/if}

		{#if thesesStore.groups.length > 0 || thesesStore.matrices.length > 0 || thesesStore.volumeGuides.length > 0 || thesesStore.protocolGuides.length > 0}
			<div class="theses-block">
				<h3>Тезисы и принципы</h3>
				<p class="muted theses-note">
					Хранятся в <code>data/training-theses.json</code> и локально в браузере — можно подключать к
					подсказкам и планированию позже.
				</p>
				{#each thesesStore.groups as group (group.id)}
					<article class="thesis-group">
						<h4>{group.title}</h4>
						{#if group.source}
							<p class="muted thesis-source">{group.source}</p>
						{/if}
						<ol class="thesis-list">
							{#each group.theses as thesis (thesis.id)}
								<li>{thesis.text}</li>
							{/each}
						</ol>
					</article>
				{/each}

				{#each thesesStore.matrices as matrix (matrix.id)}
					<article class="thesis-group intensity-matrix-block">
						<h4>{matrix.title}</h4>
						{#if matrix.note}
							<p class="muted thesis-source">{matrix.note}</p>
						{/if}
						<div class="intensity-matrix-wrap">
							<table class="intensity-matrix">
								<thead>
									<tr>
										<th></th>
										{#each matrix.bands as band (band.id)}
											<th>{band.label}</th>
										{/each}
									</tr>
								</thead>
								<tbody>
									{#each matrix.rows as row (row.id)}
										<tr>
											<th scope="row">{row.label}</th>
											{#each row.stars as stars, index (matrix.bands[index]?.id ?? index)}
												<td
													class="stars-cell"
													class:strong={stars >= (matrix.maxStars ?? 4) - 1}
													title="{stars} из {matrix.maxStars ?? 4}"
												>
													<span aria-hidden="true">{formatAdaptationStars(stars, matrix.maxStars ?? 4)}</span>
												</td>
											{/each}
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</article>
				{/each}

				{#each thesesStore.volumeGuides as guide (guide.id)}
					<article class="thesis-group volume-guide-block">
						<h4>{guide.title}</h4>
						{#if guide.note}
							<p class="muted thesis-source">{guide.note}</p>
						{/if}
						<div class="intensity-matrix-wrap">
							<table class="intensity-matrix volume-guide-table">
								<thead>
									<tr>
										<th>%</th>
										<th>Повторения</th>
										<th>Оптимально</th>
										<th>Диапазон</th>
									</tr>
								</thead>
								<tbody>
									{#each guide.rows as row (row.id)}
										<tr>
											<th scope="row">{row.percentLabel}</th>
											<td>{row.repsPerSet}</td>
											<td><strong>{row.optimalTotalReps}</strong></td>
											<td>{row.totalRangeLabel}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</article>
				{/each}

				{#each thesesStore.protocolGuides as guide (guide.id)}
					<article class="thesis-group protocol-guide-block">
						<h4>{guide.title}</h4>
						{#if guide.note}
							<p class="muted thesis-source">{guide.note}</p>
						{/if}
						{#if guide.example}
							<p class="protocol-guide-example"><strong>Пример:</strong> {guide.example}</p>
						{/if}
						{#if guide.tasks?.length}
							<div class="protocol-guide-section">
								<h5>Задачи</h5>
								<ul>
									{#each guide.tasks as task}
										<li>{task}</li>
									{/each}
								</ul>
							</div>
						{/if}
						<div class="protocol-guide-columns">
							{#if guide.strengths?.length}
								<div class="protocol-guide-section">
									<h5>Сильные стороны</h5>
									<ul>
										{#each guide.strengths as item}
											<li>{item}</li>
										{/each}
									</ul>
								</div>
							{/if}
							{#if guide.weaknesses?.length}
								<div class="protocol-guide-section">
									<h5>Минусы</h5>
									<ul>
										{#each guide.weaknesses as item}
											<li>{item}</li>
										{/each}
									</ul>
								</div>
							{/if}
						</div>
						{#if guide.recommendations?.length}
							<div class="protocol-guide-section">
								<h5>{guide.recommendationsTitle ?? 'Рекомендации'}</h5>
								<ul>
									{#each guide.recommendations as item}
										<li>{item}</li>
									{/each}
								</ul>
							</div>
						{/if}
						{#if guide.weeks?.length}
							<div class="intensity-matrix-wrap">
								<table class="intensity-matrix protocol-week-table">
									<thead>
										<tr>
											<th></th>
											{#each guide.weeks as week (week.id)}
												<th>{week.weekLabel}</th>
											{/each}
										</tr>
									</thead>
									<tbody>
										{#if guide.weeks.some((week) => week.loadLabel)}
											<tr>
												<th scope="row">Нагрузка</th>
												{#each guide.weeks as week (week.id)}
													<td>{week.loadLabel}</td>
												{/each}
											</tr>
										{/if}
										<tr>
											<th scope="row">{guide.primaryRowLabel ?? 'Основное упражнение'}</th>
											{#each guide.weeks as week (week.id)}
												<td>{week.prescription}</td>
											{/each}
										</tr>
										{#if guide.weeks.some((week) => week.accessoryPrescription != null)}
											<tr>
												<th scope="row">{guide.accessoryRowLabel ?? 'Дополнительное упражнение'}</th>
												{#each guide.weeks as week (week.id)}
													<td>{week.accessoryPrescription ?? '—'}</td>
												{/each}
											</tr>
										{/if}
										{#if guide.weeks.some((week) => week.goal)}
											<tr>
												<th scope="row">Цель</th>
												{#each guide.weeks as week (week.id)}
													<td>{week.goal ?? '—'}</td>
												{/each}
											</tr>
										{/if}
									</tbody>
								</table>
							</div>
						{/if}
					</article>
				{/each}
			</div>
		{/if}
	</section>
	{/if}
{:else}
<!-- 2. Выбор макро / мезо -->
{#if displayMesos.length === 0}
	<section class="card empty-state">
		<h3>Нет данных о циклах</h3>
		<p class="muted">Создай макроцикл в конструкторе или импортируй автоопределение из тренировок.</p>
		<div class="empty-actions">
			<button type="button" class="btn primary" onclick={openMacroConstructor}>Конструктор макроцикла</button>
			<button type="button" class="btn" onclick={() => openMesoConstructor()}>Один мезо-блок</button>
			{#if !usingManual}
				<button type="button" class="btn" onclick={handleImport}>Импорт из авто</button>
			{/if}
		</div>
	</section>
{:else}
	{#if displayMacros.length > 0}
		<section class="card macro-picker">
			<div class="picker-head">
				<h3>Макроциклы</h3>
				{#if usingManual}
					<button type="button" class="btn small primary" onclick={openMacroConstructor}>+ Макро</button>
				{/if}
			</div>
			<div class="meso-tabs">
				{#each displayMacros as macro (macro.plan.id)}
					<button
						type="button"
						class="meso-tab macro-tab"
						class:active={selectedMacro?.plan.id === macro.plan.id}
						style="--meso-color: {mesocycleColor(macro.index)}"
						onclick={() => {
							macroPick = macro.plan.id;
							mesoPick = macro.mesocycles[macro.mesocycles.length - 1]?.plan.id ?? null;
						}}
					>
						<span class="meso-tab-num">M{macro.index}</span>
						<span class="meso-tab-label">{macro.plan.label}</span>
						<span class="meso-tab-dates">
							{formatDateRu(macro.plan.startDate)} — {formatDateRu(macro.plan.endDate)}
							· {macro.mesocycles.length} мезо
						</span>
					</button>
				{/each}
			</div>
			{#if selectedMacro && usingManual && plan}
				<div class="macro-inline-edit">
					<input
						class="field-input"
						value={selectedMacro.plan.label}
						onchange={(e) => handleMacroLabel(selectedMacro, e.currentTarget.value)}
					/>
					<button
						type="button"
						class="btn small danger"
						onclick={() => handleRemoveMacro(selectedMacro.plan.id)}
					>
						Удалить макро
					</button>
				</div>
			{/if}
		</section>
	{/if}

	{#if displayOrphans.length > 0 && displayMacros.length > 0}
		<section class="card meso-picker orphan-picker">
			<div class="picker-head">
				<h3>Мезо вне макро</h3>
			</div>
			<div class="meso-tabs">
				{#each displayOrphans as meso (meso.plan.id)}
					<button
						type="button"
						class="meso-tab"
						class:active={selectedMacro == null && selectedMeso?.plan.id === meso.plan.id}
						style="--meso-color: {mesocycleColor(meso.index)}"
						onclick={() => {
							macroPick = null;
							mesoPick = meso.plan.id;
						}}
					>
						<span class="meso-tab-num">#{meso.index}</span>
						<span class="meso-tab-label">{meso.plan.label}</span>
					</button>
				{/each}
			</div>
		</section>
	{/if}

	<section class="card meso-picker">
		<div class="picker-head">
			<h3>{selectedMacro ? `Мезо в «${selectedMacro.plan.label}»` : 'Мезоциклы'}</h3>
			{#if usingManual}
				<button
					type="button"
					class="btn small primary"
					onclick={() => openMesoConstructor(selectedMacro?.plan.id ?? null)}
				>
					+ Мезо
				</button>
			{/if}
		</div>
		{#if scopedMesos.length === 0}
			<p class="muted">В этом макро пока нет мезо-блоков.</p>
		{:else}
			<div class="meso-tabs">
				{#each scopedMesos as meso (meso.plan.id)}
					<button
						type="button"
						class="meso-tab"
						class:active={selectedMeso?.plan.id === meso.plan.id}
						style="--meso-color: {mesocycleColor(meso.index)}"
						onclick={() => (mesoPick = meso.plan.id)}
					>
						<span class="meso-tab-num">#{meso.index}</span>
						<span class="meso-tab-label">{meso.plan.label}</span>
						<span class="meso-tab-dates">
							{formatDateRu(meso.plan.startDate)} — {formatDateRu(meso.plan.endDate)}
						</span>
					</button>
				{/each}
			</div>
		{/if}
	</section>

	{#if selectedMeso}
		<!-- 3. Детали выбранного мезо -->
		<section class="card meso-detail" style="--meso-color: {mesocycleColor(selectedMeso.index)}">
			<div class="detail-head">
				<div>
					<p class="detail-kicker">Мезоцикл #{selectedMeso.index}</p>
					{#if usingManual && plan}
						<input
							class="detail-title-input"
							value={selectedMeso.plan.label}
							onchange={(e) => handleMesoLabel(selectedMeso, e.currentTarget.value)}
						/>
					{:else}
						<h3>{selectedMeso.plan.label}</h3>
					{/if}
					<p class="muted">
						{formatDateRu(selectedMeso.plan.startDate)} — {formatDateRu(selectedMeso.plan.endDate)}
						· {selectedMeso.durationDays} дн.
						· {selectedMeso.completeMicrocycles}/{selectedMeso.microcycles.length} полных μ
					</p>
				</div>
				<div class="detail-actions">
					{#if nextMicroToLog}
						<a
							class="btn small primary"
							href={todayWorkoutUrl(selectedMeso.plan.id, nextMicroToLog.plan.id)}
						>
							Записать тренировку
						</a>
					{/if}
					{#if usingManual && plan}
						<button type="button" class="btn small" onclick={() => handleAddMicro(selectedMeso.plan.id)}>
							+ μ
						</button>
						<button
							type="button"
							class="btn small danger"
							onclick={() => handleRemoveMeso(selectedMeso.plan.id)}
						>
							Удалить мезо
						</button>
					{/if}
				</div>
			</div>

			<!-- Внутренние вкладки -->
			<div class="sub-tabs">
				<button
					type="button"
					class="sub-tab"
					class:active={mesoTab === 'plan'}
					onclick={() => (mesoTab = 'plan')}
				>
					План (% и цели)
				</button>
				{#if usingManual}
					<button
						type="button"
						class="sub-tab"
						class:active={mesoTab === 'settings'}
						onclick={() => (mesoTab = 'settings')}
					>
						Настройки
					</button>
				{/if}
			</div>

			{#if mesoTab === 'plan'}
				<div class="tab-panel">
					<p class="panel-hint muted">
						План (% и кг) по якорному 1ПМ · факт — лучший подход в конкретный день.
						Тренировки <strong>A</strong> и <strong>B</strong> — отдельные блоки: в каждом только
						упражнения этого дня, колонки — микроциклы с датами.
					</p>
					<div class="plan-sessions">
						{#each [0, 1] as sessionIndex}
							{@const slot = sessionIndex as 0 | 1}
							{@const rows = planMatrixForSession(selectedMeso.protocolMatrix, slot)}
							{#if rows.length > 0}
								<section
									class="session-plan-block"
									class:session-a={slot === 0}
									class:session-b={slot === 1}
								>
									<h3 class="session-plan-title" title={sessionIndexLabel(slot)}>
										Тренировка {sessionColumnTitle(slot)}
									</h3>
									<div class="matrix-wrap">
										<table class="matrix">
											<colgroup>
												<col class="col-ex" />
												<col class="col-rm" />
												<col class="col-proto" />
												{#each selectedMeso.microcycles as _micro}
													<col class="col-session" />
												{/each}
											</colgroup>
											<thead>
												<tr>
													<th>Упражнение</th>
													<th>Якорь / текущ.</th>
													<th>Протокол</th>
													{#each selectedMeso.microcycles as micro (micro.plan.id)}
														{@const date = sessionDayDate(micro, slot)}
														<th
															class="session-head"
															class:micro-group-start={micro.plan.indexInMeso > 1}
														>
															<div class="session-head-inner">
																<span class="session-mu">μ{micro.plan.indexInMeso}</span>
																{#if date}
																	<a
																		class="day-link"
																		class:a={slot === 0}
																		class:b={slot === 1}
																		href="{base}/?date={date}"
																	>
																		{formatDateRu(date)}
																	</a>
																{:else}
																	<span class="day-missing">—</span>
																{/if}
																<a
																	class="micro-log-link"
																	href={sessionAddUrl(
																		selectedMeso.plan.id,
																		micro.plan.id,
																		date,
																		slot
																	)}
																	title="Записать тренировку"
																>
																	+
																</a>
															</div>
														</th>
													{/each}
												</tr>
											</thead>
											<tbody>
												{#each rows as row}
													{@const rm = selectedMeso.anchorInfo[row.exercise]}
													<tr>
														<td class="ex-name">{row.exercise}</td>
														<td class="rm-cell">
															<RmLabels
																anchor={row.anchor}
																current={rm?.current1rm}
																currentDate={rm?.current1rmDate}
																stacked
															/>
														</td>
														<td class="proto-name" title={row.templateName}>
															{shortProtocolName(row.templateName)}
														</td>
														{#each row.cells as cell}
															<td
																class="pct"
																class:micro-group-start={cell.microIndex > 1}
																class:na={!cell.applicable}
																class:match={cell.applicable &&
																	!cell.plannedOnly &&
																	cell.pct != null &&
																	cell.factMaxPct != null &&
																	Math.abs(cell.factMaxPct - cell.pct) <= 3}
																title={cell.label ?? ''}
															>
																{#if !cell.applicable}
																	<span class="fact-empty">—</span>
																{:else}
																	<div class="cell-plan">
																		<span class="cell-label">план</span>
																		<span class="pct-val">{cell.pct != null ? `${cell.pct}%` : '—'}</span>
																		{#if cell.targetWeight != null}
																			<small>{fmtNum(cell.targetWeight)} кг</small>
																		{/if}
																	</div>
																	<div class="cell-fact">
																		<span class="cell-label">факт</span>
																		{#if cell.plannedOnly || cell.factMaxPct == null || cell.factMaxWeight == null}
																			<span class="fact-empty">—</span>
																		{:else}
																			<span class="fact-val">{fmtNum(cell.factMaxPct)}%</span>
																			<small>{fmtNum(cell.factMaxWeight)} кг</small>
																		{/if}
																	</div>
																{/if}
															</td>
														{/each}
													</tr>
												{/each}
											</tbody>
										</table>
									</div>
								</section>
							{/if}
						{/each}
					</div>
					{#if selectedMeso.gapAfterDays !== null && selectedMeso.gapAfterDays >= 14}
						<p class="gap-note">
							Перерыв до следующего блока: {Math.round(selectedMeso.gapAfterDays / 7)} нед.
						</p>
					{/if}
				</div>
			{:else if mesoTab === 'settings' && usingManual && plan}
				<div class="tab-panel">
					{#if unassigned.length > 0}
						<div class="settings-block">
							<h4>Нераспределённые дни ({unassigned.length})</h4>
							<div class="chip-row">
								{#each unassigned as date}
									<span class="chip">{formatDateRu(date)}</span>
								{/each}
							</div>
						</div>
					{/if}

					<div class="settings-block">
						<div class="block-head">
							<h4>Упражнения: якорный и текущий 1ПМ, протокол</h4>
							<div class="block-head-actions">
								<select
									class="field-select"
									bind:value={mesoAddExercisePick}
									onchange={(e) => handleAddExerciseToMeso(selectedMeso, e.currentTarget.value)}
								>
									<option value="">+ из каталога</option>
									{#each mesoExercisesAvailableToAdd(selectedMeso) as name (name)}
										<option value={name}>{name}</option>
									{/each}
								</select>
								<a class="btn small ghost-link" href="{base}/exercises">Каталог</a>
								<button type="button" class="btn small" onclick={() => handleSyncExercises(selectedMeso)}>
									Подтянуть из тренировок
								</button>
							</div>
						</div>
						<div class="exercise-settings">
							{#each Object.entries(selectedMeso.anchorInfo) as [exercise, info]}
								<div class="exercise-setting-row">
									<div class="exercise-setting-main">
										<strong>{exercise}</strong>
										<RmLabels
											anchor={info.anchor}
											current={info.current1rm}
											currentDate={info.current1rmDate}
										/>
										<span class="muted">{anchorSourceLabel(info)}</span>
									</div>
									<label>
										<span>Якорный 1ПМ, кг</span>
										<input
											type="number"
											step="0.5"
											class="field-input"
											value={info.anchor}
											onchange={(e) => handleAnchor1rm(selectedMeso, exercise, e.currentTarget.value)}
										/>
									</label>
									<label>
										<span>Протокол</span>
										<select
											class="field-select"
											value={exerciseTemplateId(selectedMeso, exercise)}
											onchange={(e) =>
												handleExerciseProtocol(selectedMeso, exercise, e.currentTarget.value)}
										>
											{#each plan.templates as tpl}
												<option value={tpl.id}>{tpl.name}</option>
											{/each}
										</select>
									</label>
									<button
										type="button"
										class="btn small danger"
										onclick={() => handleRemoveExercise(selectedMeso, exercise)}
									>
										×
									</button>
								</div>
							{/each}
						</div>
					</div>

					<div class="settings-block">
						<h4>Распределение дней по μ</h4>
						<div class="assign-grid">
							{#each selectedMeso.microcycles as micro}
								<div class="assign-card">
									<div class="assign-head">
										<strong>μ{micro.plan.indexInMeso}</strong>
										<button
											type="button"
											class="btn small danger"
											onclick={() => handleRemoveMicro(selectedMeso.plan.id, micro.plan.id)}
										>
											×
										</button>
									</div>
									<div class="chip-row">
										{#each microDates(micro.plan) as date}
											<span class="chip">
												{formatDateRu(date)}
												<button type="button" class="chip-x" onclick={() => handleUnassign(date)}>×</button>
											</span>
										{/each}
										{#if microDates(micro.plan).length === 0}
											<span class="muted">нет дней</span>
										{/if}
									</div>
									{#if unassigned.length > 0}
										<select
											class="field-select"
											onchange={(e) => {
												handleAssign(selectedMeso.plan.id, micro.plan.id, e.currentTarget.value);
												e.currentTarget.value = '';
											}}
										>
											<option value="">+ добавить день</option>
											{#each unassigned as date}
												<option value={date}>{formatDateRu(date)}</option>
											{/each}
										</select>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				</div>
			{/if}
		</section>
	{/if}
{/if}
{/if}
</div>

<style>
	.cycles-page {
		display: grid;
		gap: 1rem;
		min-width: 0;
		max-width: 100%;
		overflow-x: clip;
	}

	.planning-tabs {
		display: flex;
		gap: 0.35rem;
		flex-wrap: wrap;
		margin-bottom: 0.15rem;
	}

	.planning-tab {
		padding: 0.5rem 0.9rem;
		border: 1px solid var(--line);
		border-radius: 0;
		background: transparent;
		color: var(--muted);
		font-size: 0.85rem;
		font-weight: 700;
		cursor: pointer;
	}

	.planning-tab.active {
		color: var(--text);
		background: var(--surface-2);
		border-color: var(--line-strong);
	}

	.planning-head {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 2rem;
		margin-bottom: 0.25rem;
		padding: 0.3rem 0 0.5rem;
	}

	.planning-head h1 {
		margin: 0.35rem 0 0.5rem;
	}

	.planning-head p {
		max-width: 650px;
		margin: 0;
		color: var(--muted);
		line-height: 1.55;
	}

	@media (max-width: 900px) {
		.planning-head {
			align-items: flex-start;
			flex-direction: column;
		}
	}

	h3,
	h4 {
		margin: 0;
	}

	.head-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		align-items: center;
	}

	.btn {
		border-radius: 0;
		padding: 0.5rem 0.85rem;
		border: none;
		background: var(--surface-2);
		color: var(--text);
	}

	.btn.primary {
		background: rgba(110, 231, 168, 0.14);
		color: var(--accent);
	}

	.btn.small {
		padding: 0.3rem 0.55rem;
		font-size: 0.78rem;
	}

	.btn.danger,
	.btn.small.danger {
		color: var(--danger);
		background: rgba(255, 143, 143, 0.08);
	}

	.btn.ghost-link {
		background: transparent;
		color: var(--muted);
	}

	.ab-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 0.75rem;
		margin-top: 0.75rem;
	}

	.protocol-catalog {
		margin-top: 1.25rem;
		padding-top: 1.25rem;
		border-top: 1px solid var(--border);
	}

	.protocol-catalog h3 {
		margin: 0 0 0.35rem;
	}

	.protocol-guide-example {
		margin: 0 0 0.75rem;
		font-size: 0.88rem;
	}

	.protocol-guide-section h5 {
		margin: 0 0 0.35rem;
		font-size: 0.82rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--muted);
	}

	.protocol-guide-section ul {
		margin: 0;
		padding-left: 1.15rem;
		display: grid;
		gap: 0.3rem;
	}

	.protocol-guide-section + .protocol-guide-section {
		margin-top: 0.75rem;
	}

	.protocol-guide-columns {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.85rem;
		margin-top: 0.75rem;
	}

	.protocol-week-table th,
	.protocol-week-table td {
		text-align: center;
		font-size: 0.82rem;
	}

	.protocol-week-table th[scope='row'] {
		text-align: left;
		white-space: nowrap;
	}

	.theses-block {
		margin-top: 1.25rem;
		padding-top: 1.25rem;
		border-top: 1px solid var(--border);
	}

	.theses-block h3 {
		margin: 0 0 0.35rem;
	}

	.theses-note {
		margin: 0 0 1rem;
		font-size: 0.82rem;
	}

	.thesis-group + .thesis-group {
		margin-top: 1rem;
	}

	.thesis-group h4 {
		margin: 0 0 0.25rem;
		font-size: 0.95rem;
	}

	.thesis-source {
		margin: 0 0 0.5rem;
		font-size: 0.78rem;
	}

	.thesis-list {
		margin: 0;
		padding-left: 1.2rem;
		display: grid;
		gap: 0.35rem;
		font-size: 0.88rem;
		color: var(--text);
	}

	.intensity-matrix-wrap {
		overflow-x: auto;
		margin-top: 0.5rem;
	}

	.intensity-matrix {
		width: 100%;
		min-width: 32rem;
		border-collapse: collapse;
		font-size: 0.78rem;
	}

	.intensity-matrix th,
	.intensity-matrix td {
		padding: 0.4rem 0.35rem;
		border: none;
		border-bottom: 1px solid var(--line);
		text-align: center;
		vertical-align: middle;
	}

	.intensity-matrix thead th {
		background: var(--surface-2);
		color: var(--muted);
		font-weight: 600;
		font-size: 0.72rem;
	}

	.intensity-matrix tbody th {
		text-align: left;
		font-weight: 600;
		font-size: 0.75rem;
		line-height: 1.25;
	}

	.intensity-matrix .stars-cell {
		color: #fbbf24;
		letter-spacing: 0.02em;
		white-space: nowrap;
	}

	.intensity-matrix .stars-cell.strong {
		color: #fde68a;
	}

	.ab-card {
		padding: 0.85rem;
		border-radius: 0;
		border: none;
		background: color-mix(in srgb, var(--slot-color) 8%, var(--surface-2));
	}

	.slot-badge {
		display: inline-grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		margin-right: 0.35rem;
		border-radius: 0;
		background: var(--slot-color);
		color: #0f1115;
		font-size: 0.8rem;
		font-weight: 800;
	}

	.meta {
		margin: 0.25rem 0 0;
		font-size: 0.82rem;
		color: var(--muted);
	}

	.empty-state {
		text-align: center;
		padding: 2rem 1.25rem;
	}

	.empty-state h3 {
		margin-bottom: 0.35rem;
	}

	.empty-state .btn {
		margin-top: 1rem;
	}

	.empty-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: center;
		margin-top: 1rem;
	}

	.constructor-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		z-index: 40;
	}

	.meso-constructor,
	.macro-constructor {
		position: fixed;
		top: 50%;
		left: 50%;
		z-index: 41;
		transform: translate(-50%, -50%);
		width: min(960px, calc(100vw - 1.5rem));
		max-height: calc(100vh - 2rem);
		overflow: auto;
		padding: 1.1rem 1.15rem 1rem;
	}

	.constructor-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.constructor-head h3 {
		margin: 0 0 0.25rem;
	}

	.constructor-head-actions,
	.block-head-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.45rem;
	}

	.constructor-add-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: flex-end;
		margin-bottom: 0.75rem;
	}

	.constructor-add-row label {
		display: grid;
		gap: 0.3rem;
		min-width: min(240px, 100%);
		font-size: 0.78rem;
		color: var(--muted);
	}

	.constructor-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: flex-end;
		margin-bottom: 1rem;
	}

	.macro-blocks {
		display: grid;
		gap: 0.65rem;
		margin-bottom: 0.75rem;
	}

	.macro-blocks-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
	}

	.macro-blocks-head h4,
	.macro-preview h4 {
		margin: 0;
		font-size: 0.95rem;
	}

	.macro-block-card {
		padding: 0.75rem 0;
		border-radius: 0;
		border: none;
		border-bottom: 1px solid var(--line);
		background: transparent;
	}

	.macro-block-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
		align-items: flex-end;
	}

	.macro-block-meta label {
		display: grid;
		gap: 0.25rem;
		font-size: 0.78rem;
		color: var(--muted);
		min-width: 8rem;
	}

	.macro-block-dates {
		margin: 0.5rem 0 0;
		font-size: 0.82rem;
	}

	.macro-block-exercises {
		margin-top: 0.75rem;
	}

	.macro-block-exercises summary {
		cursor: pointer;
		font-size: 0.88rem;
		font-weight: 600;
		margin-bottom: 0.5rem;
	}

	.macro-block-exercises .constructor-table-wrap {
		margin-top: 0.35rem;
	}

	.macro-preview {
		margin-top: 1rem;
		display: grid;
		gap: 0.5rem;
	}

	.macro-preview-block summary {
		cursor: pointer;
		font-size: 0.88rem;
		padding: 0.35rem 0;
	}

	.macro-inline-edit {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		margin-top: 0.75rem;
	}

	.orphan-picker {
		border: none;
	}

	.matrix-wrap.compact .matrix {
		font-size: 0.82rem;
	}

	.constructor-meta label {
		display: grid;
		gap: 0.25rem;
		font-size: 0.78rem;
		color: var(--muted);
	}

	.constructor-table-wrap {
		overflow: auto;
		border: none;
		border-radius: 0;
		margin-bottom: 1rem;
	}

	.constructor-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.82rem;
	}

	.constructor-table th,
	.constructor-table td {
		padding: 0.45rem 0.5rem;
		border: none;
		border-bottom: 1px solid var(--line);
		vertical-align: middle;
	}

	.constructor-table thead th {
		background: var(--surface-2);
		text-align: left;
		font-size: 0.72rem;
		color: var(--muted);
	}

	.constructor-table tr.disabled td:not(:first-child) {
		opacity: 0.45;
	}

	.constructor-table .source-cell {
		font-size: 0.72rem;
		white-space: nowrap;
	}

	.constructor-preview h4 {
		margin: 0 0 0.5rem;
		font-size: 0.92rem;
	}

	.constructor-preview-matrix .phase-label {
		display: block;
		margin-top: 0.15rem;
	}

	.constructor-empty {
		margin: 0 0 1rem;
	}

	.constructor-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--border);
	}

	.picker-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.meso-picker {
		min-width: 0;
		overflow: hidden;
	}

	.meso-picker,
	.macro-picker,
	.orphan-picker,
	.meso-detail {
		border: none;
		box-shadow: none;
		background: transparent;
	}

	.meso-tabs {
		display: flex;
		gap: 0.35rem;
		overflow-x: auto;
		padding: 0;
		max-width: 100%;
		background: transparent;
		scrollbar-width: thin;
	}

	.meso-tab {
		flex: 0 0 auto;
		min-width: 9rem;
		padding: 0.65rem 0.85rem;
		border-radius: 0;
		border: none;
		background: transparent;
		text-align: left;
		color: var(--text);
	}

	.meso-tab.active {
		background: var(--surface-2);
		color: var(--text);
	}

	.meso-tab-num {
		display: block;
		font-weight: 800;
		color: var(--meso-color);
		font-size: 0.85rem;
	}

	.meso-tab-label {
		display: block;
		font-size: 0.82rem;
		margin-top: 0.15rem;
	}

	.meso-tab-dates {
		display: block;
		font-size: 0.72rem;
		color: var(--muted);
		margin-top: 0.15rem;
	}

	.meso-detail {
		min-width: 0;
		overflow: hidden;
	}

	.detail-head {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}

	.detail-kicker {
		margin: 0 0 0.15rem;
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--meso-color);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.detail-title-input {
		width: 100%;
		max-width: 320px;
		font-size: 1.25rem;
		font-weight: 700;
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--line);
		border-radius: 0;
		color: var(--text);
		padding: 0.35rem 0;
		margin-bottom: 0.25rem;
	}

	.detail-actions {
		display: flex;
		gap: 0.35rem;
		align-items: start;
	}

	.sub-tabs {
		display: flex;
		gap: 0.35rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
		padding: 0;
		border-radius: 0;
		background: transparent;
	}

	.sub-tab {
		padding: 0.45rem 0.85rem;
		border-radius: 0;
		border: none;
		background: transparent;
		color: var(--muted);
		font-size: 0.85rem;
	}

	.sub-tab.active {
		background: var(--surface-2);
		color: var(--text);
	}

	.panel-hint {
		margin: 0 0 0.75rem;
		font-size: 0.82rem;
	}

	.plan-sessions {
		display: grid;
		gap: 1.25rem;
	}

	.session-plan-title {
		margin: 0 0 0.45rem;
		font-size: 0.82rem;
		font-weight: 700;
		letter-spacing: 0.04em;
	}

	.session-plan-block.session-a .session-plan-title {
		color: #5b9dff;
	}

	.session-plan-block.session-b .session-plan-title {
		color: #6ee7a8;
	}

	.session-plan-block .matrix {
		min-width: 32rem;
	}

	.matrix-wrap {
		overflow-x: auto;
		max-width: 100%;
		margin: 0 -0.15rem;
		padding: 0 0.15rem 0.25rem;
		-webkit-overflow-scrolling: touch;
	}

	.matrix {
		width: 100%;
		min-width: 48rem;
		border-collapse: separate;
		border-spacing: 0;
		font-size: 0.82rem;
		table-layout: fixed;
	}

	.matrix :global(col.col-ex) {
		width: 14rem;
	}

	.matrix :global(col.col-rm) {
		width: 6.75rem;
	}

	.matrix :global(col.col-proto) {
		width: 5.5rem;
	}

	.matrix :global(col.col-session) {
		width: 5.5rem;
	}

	.matrix th,
	.matrix td {
		padding: 0.55rem 0.45rem;
		border: none;
		border-bottom: 1px solid var(--line);
		text-align: center;
		vertical-align: middle;
		line-height: 1.25;
	}

	.matrix thead th {
		border-bottom: 1px solid var(--line-strong);
	}

	.matrix thead th {
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--surface-2);
		color: var(--muted);
		font-size: 0.72rem;
		font-weight: 600;
	}

	.matrix tbody tr:nth-child(even) td {
		background: rgba(255, 255, 255, 0.02);
	}

	.matrix .ex-name {
		text-align: left;
		font-weight: 600;
		font-size: 0.78rem;
		line-height: 1.25;
		word-break: break-word;
	}

	.matrix .rm-cell {
		font-weight: 600;
		white-space: nowrap;
	}

	.matrix .proto-name {
		text-align: left;
		font-size: 0.7rem;
		color: #c4b5fd;
		line-height: 1.2;
		word-break: break-word;
	}

	.matrix .pct {
		padding: 0.35rem 0.25rem;
		vertical-align: top;
	}

	.matrix .pct.match {
		background: rgba(110, 231, 168, 0.08);
	}

	.matrix .cell-plan,
	.matrix .cell-fact {
		display: grid;
		gap: 0.05rem;
		justify-items: center;
	}

	.matrix .cell-fact {
		margin-top: 0.35rem;
		padding-top: 0.3rem;
	}

	.matrix .cell-label {
		font-size: 0.58rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted);
	}

	.matrix .pct small {
		display: block;
		font-size: 0.66rem;
		color: var(--muted);
		font-weight: 400;
		white-space: nowrap;
	}

	.matrix .pct-val {
		display: block;
		font-weight: 700;
		color: var(--accent-2);
	}

	.matrix .fact-val {
		display: block;
		font-weight: 700;
		color: var(--text);
	}

	.matrix .fact-empty {
		font-size: 0.75rem;
		color: var(--muted);
	}

	.matrix .pct.match .fact-val {
		color: var(--accent);
	}

	.matrix .session-head {
		padding: 0.35rem 0.25rem;
		vertical-align: bottom;
		font-weight: 500;
	}

	.matrix .session-head-inner {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.18rem;
		min-width: 0;
	}

	.matrix .session-mu {
		font-size: 0.58rem;
		font-weight: 600;
		color: var(--muted);
		letter-spacing: 0.02em;
	}

	.day-link {
		display: block;
		width: 100%;
		padding: 0.18rem 0.3rem;
		border-radius: 0;
		text-decoration: none;
		font-size: 0.64rem;
		line-height: 1.2;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.day-link.a {
		background: rgba(91, 157, 255, 0.1);
		color: var(--text);
	}

	.day-link.b {
		background: rgba(110, 231, 168, 0.1);
		color: var(--text);
	}

	.day-missing {
		font-size: 0.64rem;
		color: var(--muted);
	}

	.micro-log-link {
		display: inline-grid;
		width: 1.1rem;
		height: 1.1rem;
		place-items: center;
		color: var(--accent);
		background: rgba(110, 231, 168, 0.1);
		text-decoration: none;
		font-size: 0.85rem;
		font-weight: 800;
		line-height: 1;
	}

	.matrix .micro-group-start {
		border-left: 2px solid var(--line-strong);
	}

	.session-plan-block.session-a .matrix .pct:not(.na) {
		background: rgb(91 157 255 / 3%);
	}

	.session-plan-block.session-b .matrix .pct:not(.na) {
		background: rgb(110 231 168 / 3%);
	}

	.matrix .pct.na {
		opacity: 0.28;
	}

	.gap-note {
		margin: 0;
		font-size: 0.82rem;
		color: var(--danger);
	}

	.settings-block {
		padding: 0.85rem 0;
		border-radius: 0;
		border: none;
		border-bottom: 1px solid var(--line);
		background: transparent;
		margin-bottom: 0.75rem;
	}

	.settings-block h4 {
		margin-bottom: 0.5rem;
		font-size: 0.92rem;
	}

	.block-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.block-head h4 {
		margin: 0;
	}

	.chip-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.2rem 0.45rem;
		border-radius: 0;
		border: none;
		background: var(--surface-2);
		font-size: 0.78rem;
	}

	.chip-x {
		border: none;
		background: transparent;
		color: var(--danger);
		padding: 0;
		line-height: 1;
	}

	.exercise-settings {
		display: grid;
		gap: 0.5rem;
	}

	.exercise-setting-row {
		display: grid;
		grid-template-columns: 1fr auto auto auto;
		gap: 0.5rem;
		align-items: end;
		padding: 0.5rem 0;
		border-radius: 0;
		border: none;
		border-bottom: 1px solid var(--line);
		background: transparent;
	}

	.exercise-setting-main {
		display: grid;
		gap: 0.25rem;
	}

	.exercise-setting-row label {
		display: grid;
		gap: 0.15rem;
		font-size: 0.72rem;
		color: var(--muted);
	}

	.field-input,
	.field-select {
		background: var(--surface-2);
		border: none;
		border-bottom: 1px solid var(--line);
		border-radius: 0;
		color: var(--text);
		padding: 0.35rem 0.25rem;
		min-width: 0;
	}

	.field-input.narrow {
		width: 3rem;
	}

	.assign-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.5rem;
	}

	.assign-card {
		padding: 0.65rem 0;
		border-radius: 0;
		border: none;
		border-bottom: 1px solid var(--line);
		background: transparent;
		display: grid;
		gap: 0.45rem;
	}

	.assign-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	@media (max-width: 720px) {
		.exercise-setting-row {
			grid-template-columns: 1fr;
		}

		.meso-tab {
			min-width: 7.5rem;
		}
	}
</style>
