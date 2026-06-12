import { dateToMs } from './chart-time';
import {
	bundledProtocolTemplates,
	bundledProtocolById,
	DEFAULT_PROTOCOL_TEMPLATE,
	type MesoAnchor1rm,
	type ProtocolPhase,
	type ProtocolTemplate,
	best1rmAllTime,
	isBundledProtocolStub,
	isCustomProtocolId,
	phaseForMicro,
	pickMesoExercises,
	plannedSessionIntensity,
	resolveMesoAnchor1rm,
	sessionIntensity,
	STRENGTH_PROTOCOL_TEMPLATES,
	targetWeight
} from './protocol';
import type { MicrocycleOverview, TrainingDay, WorkoutTemplate } from './microcycle';
import {
	defaultMicroSessions,
	microDates,
	microFromOverviewDays,
	microHasDate,
	normalizeMicrocyclePlan,
	normalizeMicrocycles,
	sessionPlanByIndex,
	type MicrocyclePlan,
	type MicroSessionPlan
} from './micro-plan';
import {
	buildExerciseKeyMapsFromEntries,
	buildWorkoutKeyMaps,
	type ExerciseKeyMaps,
	isManualAnchor,
	mesoAnchor,
	mesoProtocolId,
	toExerciseId
} from './exercise-keys';
import type { Exercise, WorkoutEntry } from './types';

export { buildExerciseKeyMapsFromEntries, buildWorkoutKeyMaps } from './exercise-keys';
export type { ExerciseKeyMaps } from './exercise-keys';

export type { MicrocyclePlan, MicroSessionPlan };
export type { ProtocolPhase, ProtocolTemplate };
export { DEFAULT_PROTOCOL_TEMPLATE, bundledProtocolTemplates, phaseForMicro, targetWeight } from './protocol';

export type MesocyclePlan = {
	id: string;
	label: string;
	startDate: string;
	endDate: string;
	microcycles: MicrocyclePlan[];
	/** Протокол по умолчанию для упражнений без своего шаблона. */
	templateId: string;
	/** Якорные 1ПМ на старт мезо: exerciseId → кг. */
	anchor1rm: Record<string, number>;
	/** exerciseId с вручную заданным якорем — не пересчитываются автоматически. */
	anchor1rmManual?: Record<string, boolean>;
	/** Свой протокол: exerciseId → templateId. Пусто → templateId мезо. */
	exerciseProtocols?: Record<string, string>;
	/** Дни A/B для упражнения: exerciseId → [0] и/или [1]. */
	exerciseSessions?: Record<string, (0 | 1)[]>;
};

export type MacrocyclePlan = {
	id: string;
	label: string;
	startDate: string;
	endDate: string;
	/** Упорядоченные id мезоциклов внутри макро. */
	mesoIds: string[];
	note?: string;
};

export type CyclePlan = {
	version: 4;
	revision: number;
	updatedAt: string;
	templates: ProtocolTemplate[];
	macrocycles: MacrocyclePlan[];
	mesocycles: MesocyclePlan[];
};

export type EnrichedMicrocycle = {
	plan: MicrocyclePlan;
	dayA: TrainingDay | null;
	dayB: TrainingDay | null;
	complete: boolean;
	/** @deprecated используй intensityByExercise — фаза дефолтного шаблона мезо */
	phase: ProtocolPhase | null;
	/** @deprecated используй intensityByExercise */
	targetPct: number | null;
	intensityByExercise: NonNullable<ReturnType<typeof sessionIntensity>>[];
};

export type ProtocolMatrixCell = {
	microIndex: number;
	/** 0 = тренировка A, 1 = тренировка B. */
	sessionIndex: 0 | 1;
	/** Дата фактической тренировки в этом слоте, если назначена. */
	date: string | null;
	/** Упражнение входит в шаблон этого дня. */
	applicable: boolean;
	pct: number | null;
	label: string | null;
	targetWeight: number | null;
	factMaxPct: number | null;
	factMaxWeight: number | null;
	plannedOnly: boolean;
};

export type BuildProtocolMatrixOptions = {
	microViews?: EnrichedMicrocycle[];
	workoutTemplates?: WorkoutTemplate[];
};

export type ProtocolMatrixRow = {
	exercise: string;
	anchor: number;
	templateName: string;
	cells: ProtocolMatrixCell[];
};

export function compareByAnchorDesc(
	anchorInfo: Record<string, ExerciseAnchorInfo>,
	a: string,
	b: string
): number {
	const diff = (anchorInfo[b]?.anchor ?? 0) - (anchorInfo[a]?.anchor ?? 0);
	return diff !== 0 ? diff : a.localeCompare(b, 'ru');
}

export function sortExercisesByAnchorDesc(
	exercises: string[],
	anchorInfo: Record<string, ExerciseAnchorInfo>
): string[] {
	return [...exercises].sort((a, b) => compareByAnchorDesc(anchorInfo, a, b));
}

export function compareProtocolMatrixRows(a: ProtocolMatrixRow, b: ProtocolMatrixRow): number {
	const diff = b.anchor - a.anchor;
	return diff !== 0 ? diff : a.exercise.localeCompare(b.exercise, 'ru');
}

export type ExerciseAnchorInfo = {
	/** Якорный 1ПМ — фиксируется на старт мезо, основа плана % и кг. */
	anchor: number;
	source: MesoAnchor1rm['source'];
	anchorDate: string | null;
	/** Текущий 1ПМ — лучший результат за всю историю упражнения. */
	current1rm: number | null;
	current1rmDate: string | null;
	manual: boolean;
};

export type EnrichedMesocycle = {
	plan: MesocyclePlan;
	template: ProtocolTemplate;
	index: number;
	microcycles: EnrichedMicrocycle[];
	anchorInfo: Record<string, ExerciseAnchorInfo>;
	protocolMatrix: ProtocolMatrixRow[];
	completeMicrocycles: number;
	durationDays: number;
	gapAfterDays: number | null;
};

export type EnrichedMacrocycle = {
	plan: MacrocyclePlan;
	index: number;
	mesocycles: EnrichedMesocycle[];
	durationDays: number;
	gapAfterDays: number | null;
};

export type CyclePlanView = {
	plan: CyclePlan | null;
	macrocycles: EnrichedMacrocycle[];
	orphanMesocycles: EnrichedMesocycle[];
	mesocycles: EnrichedMesocycle[];
	unassignedDates: string[];
	usingManualPlan: boolean;
};

function daysBetween(a: string, b: string): number {
	return Math.round((dateToMs(b) - dateToMs(a)) / 86400000);
}

function newId(prefix: string): string {
	return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export function emptyCyclePlan(): CyclePlan {
	return {
		version: 4,
		revision: 0,
		updatedAt: '',
		templates: bundledProtocolTemplates(),
		macrocycles: [],
		mesocycles: []
	};
}

/** Нормализация протоколов и микроциклов v3. */
export function normalizeCyclePlan(plan: CyclePlan, _byDate?: Map<string, TrainingDay>): CyclePlan {
	return ensureBundledProtocols({
		...plan,
		version: 4,
		macrocycles: plan.macrocycles ?? [],
		mesocycles: plan.mesocycles.map((meso) => ({
			...meso,
			microcycles: normalizeMicrocycles(meso.microcycles)
		}))
	});
}

/** Ключ для слияния: один и тот же период тренировок, но разные id после импорта/merge. */
export function mesoRangeKey(meso: MesocyclePlan): string | null {
	const dates = meso.microcycles.flatMap((micro) => microDates(micro)).sort();
	const start = dates[0] ?? meso.startDate;
	const end = dates[dates.length - 1] ?? meso.endDate;
	if (!start || !end) return null;
	return `${start}|${end}`;
}

function mesoPlanScore(meso: MesocyclePlan, preferIds?: Set<string>): number {
	let score = 0;
	if (preferIds?.has(meso.id)) score += 1000;
	score += Object.keys(meso.anchor1rm).length * 4;
	score += Object.keys(meso.exerciseProtocols ?? {}).length * 2;
	score += Object.keys(meso.exerciseSessions ?? {}).length * 3;
	score += Object.keys(meso.anchor1rmManual ?? {}).length * 2;
	score += meso.microcycles.flatMap((micro) => microDates(micro)).length;
	return score;
}

function pickPreferredMeso(
	a: MesocyclePlan,
	b: MesocyclePlan,
	preferIds?: Set<string>
): MesocyclePlan {
	const aScore = mesoPlanScore(a, preferIds);
	const bScore = mesoPlanScore(b, preferIds);
	return bScore > aScore ? b : a;
}

function dedupeMesocycles(
	mesocycles: MesocyclePlan[],
	preferIds?: Set<string>
): { mesocycles: MesocyclePlan[]; idRemap: Map<string, string> } {
	const byKey = new Map<string, MesocyclePlan>();
	const idRemap = new Map<string, string>();

	for (const meso of mesocycles) {
		const key = mesoRangeKey(meso);
		if (!key) continue;
		const existing = byKey.get(key);
		if (!existing) {
			byKey.set(key, meso);
			continue;
		}
		const keep = pickPreferredMeso(existing, meso, preferIds);
		const drop = keep.id === existing.id ? meso : existing;
		byKey.set(key, keep);
		idRemap.set(drop.id, keep.id);
	}

	const result: MesocyclePlan[] = [];
	const addedKeys = new Set<string>();
	const addedIds = new Set<string>();

	for (const meso of mesocycles) {
		const key = mesoRangeKey(meso);
		if (!key) {
			if (!addedIds.has(meso.id)) {
				result.push(meso);
				addedIds.add(meso.id);
			}
			continue;
		}
		const canonical = byKey.get(key)!;
		if (!addedKeys.has(key)) {
			result.push(canonical);
			addedKeys.add(key);
			addedIds.add(canonical.id);
		}
	}

	return { mesocycles: result, idRemap };
}

/** Убирает дубликаты мезо с одинаковым периодом (разные id после импорта и merge). */
export function dedupeMesocyclesInPlan(
	plan: CyclePlan,
	preferMesoIds?: Iterable<string>
): CyclePlan {
	const prefer = preferMesoIds ? new Set(preferMesoIds) : undefined;
	const { mesocycles, idRemap } = dedupeMesocycles(plan.mesocycles, prefer);
	const sameOrder =
		idRemap.size === 0 &&
		mesocycles.length === plan.mesocycles.length &&
		mesocycles.every((meso, index) => meso.id === plan.mesocycles[index]?.id);
	if (sameOrder) return plan;

	const mesoIds = new Set(mesocycles.map((meso) => meso.id));
	const macrocycles = (plan.macrocycles ?? []).map((macro) => {
		const mesoIdsRemapped = [
			...new Set(
				macro.mesoIds
					.map((id) => idRemap.get(id) ?? id)
					.filter((id) => mesoIds.has(id))
			)
		];
		return mesoIdsRemapped.length === macro.mesoIds.length &&
			mesoIdsRemapped.every((id, index) => id === macro.mesoIds[index])
			? macro
			: { ...macro, mesoIds: mesoIdsRemapped };
	});

	return touchPlan({ ...plan, mesocycles, macrocycles });
}

/** Добавляет в план недостающие протоколы из каталога, сохраняя пользовательские и legacy-шаблоны. */
export function ensureBundledProtocols(plan: CyclePlan): CyclePlan {
	const existing = new Map(plan.templates.map((item) => [item.id, item]));
	const ordered: ProtocolTemplate[] = [];

	for (const bundled of STRENGTH_PROTOCOL_TEMPLATES) {
		const current = existing.get(bundled.id);
		if (!current) {
			ordered.push(structuredClone(bundled));
		} else if (isBundledProtocolStub(current)) {
			ordered.push(structuredClone(bundled));
		} else {
			ordered.push(current);
		}
		existing.delete(bundled.id);
	}

	for (const template of plan.templates) {
		if (existing.has(template.id)) ordered.push(existing.get(template.id)!);
	}

	const unchanged =
		ordered.length === plan.templates.length &&
		ordered.every((item, index) => JSON.stringify(item) === JSON.stringify(plan.templates[index]));
	if (unchanged) return plan;

	return { ...plan, templates: ordered };
}

function mesoExercisesFromPlan(
	meso: MesocyclePlan,
	entries: WorkoutEntry[],
	keyMaps: ExerciseKeyMaps
): string[] {
	const names = new Set(
		Object.keys(meso.anchor1rm).map((key) => keyMaps.nameById.get(key) ?? key)
	);
	for (const id of Object.keys(meso.exerciseSessions ?? {})) {
		names.add(keyMaps.nameById.get(id) ?? id);
	}
	for (const id of Object.keys(meso.exerciseProtocols ?? {})) {
		names.add(keyMaps.nameById.get(id) ?? id);
	}
	const dates = new Set(meso.microcycles.flatMap((micro) => microDates(micro)));
	for (const entry of entries) {
		if (dates.has(entry.date)) names.add(entry.exercise);
	}
	return pickMesoExercises([...names]);
}

function buildAnchorInfo(
	meso: MesocyclePlan,
	entries: WorkoutEntry[],
	keyMaps: ExerciseKeyMaps
): Record<string, ExerciseAnchorInfo> {
	const info: Record<string, ExerciseAnchorInfo> = {};
	for (const exercise of mesoExercisesFromPlan(meso, entries, keyMaps)) {
		const manual = isManualAnchor(meso, exercise, keyMaps);
		const computed = resolveMesoAnchor1rm(entries, exercise, meso.startDate, meso.endDate);
		const current = best1rmAllTime(entries, exercise);
		const stored = mesoAnchor(meso, exercise, keyMaps);
		const anchor = manual && stored != null ? stored : (computed?.value ?? stored);

		if (anchor == null) continue;

		info[exercise] = {
			anchor,
			source: manual ? 'manual' : (computed?.source ?? 'prior'),
			anchorDate: manual ? null : (computed?.asOfDate ?? null),
			current1rm: current?.value ?? null,
			current1rmDate: current?.date ?? null,
			manual
		};
	}
	return info;
}

function withComputedAnchors(
	meso: MesocyclePlan,
	entries: WorkoutEntry[],
	keyMaps: ExerciseKeyMaps
): MesocyclePlan {
	const exercises = mesoExercisesFromPlan(meso, entries, keyMaps);
	const anchor1rm = { ...meso.anchor1rm };
	const anchor1rmManual = { ...(meso.anchor1rmManual ?? {}) };

	for (const exercise of exercises) {
		const id = toExerciseId(exercise, keyMaps);
		if (anchor1rmManual[id]) {
			if (anchor1rm[id] != null) continue;
		}
		const resolved = resolveMesoAnchor1rm(entries, exercise, meso.startDate, meso.endDate);
		if (resolved) anchor1rm[id] = resolved.value;
	}

	return { ...meso, anchor1rm, anchor1rmManual };
}

function buildAnchor1rm(
	exercises: string[],
	entries: WorkoutEntry[],
	startDate: string,
	endDate: string,
	keyMaps: ExerciseKeyMaps
): Record<string, number> {
	const anchor1rm: Record<string, number> = {};
	for (const exercise of exercises) {
		const resolved = resolveMesoAnchor1rm(entries, exercise, startDate, endDate);
		if (resolved) anchor1rm[toExerciseId(exercise, keyMaps)] = resolved.value;
	}
	return anchor1rm;
}

function mesoExerciseNames(overview: MicrocycleOverview, mesoIndex: number): string[] {
	const meso = overview.mesocycles.find((item) => item.index === mesoIndex);
	if (!meso) return [];
	const exercises = new Set<string>();
	for (const micro of meso.microcycles) {
		for (const day of micro.days) {
			for (const exercise of day.exercises) exercises.add(exercise);
		}
	}
	return pickMesoExercises([...exercises]);
}

export function templateForExercise(
	plan: CyclePlan,
	meso: MesocyclePlan,
	exercise: string,
	keyMaps: ExerciseKeyMaps
): ProtocolTemplate {
	const templateId = mesoProtocolId(meso, exercise, keyMaps) ?? meso.templateId;
	return plan.templates.find((item) => item.id === templateId) ?? plan.templates[0];
}

export function targetPctForExercise(
	plan: CyclePlan,
	meso: MesocyclePlan,
	micro: MicrocyclePlan,
	exercise: string,
	keyMaps: ExerciseKeyMaps
): { pct: number | null; phase: ProtocolPhase | null; template: ProtocolTemplate } {
	const template = templateForExercise(plan, meso, exercise, keyMaps);
	const phase = phaseForMicro(template, micro.indexInMeso);
	const pct = phase?.intensityPct ?? null;
	return { pct, phase, template };
}

export function exercisesInMicro(
	micro: MicrocyclePlan,
	dayA: TrainingDay | null,
	dayB: TrainingDay | null,
	meso: MesocyclePlan,
	entries: WorkoutEntry[],
	keyMaps: ExerciseKeyMaps
): string[] {
	const names = new Set<string>();
	for (const day of [dayA, dayB]) {
		if (!day) continue;
		for (const exercise of day.exercises) names.add(exercise);
	}
	for (const entry of entries) {
		if (microHasDate(micro, entry.date)) names.add(entry.exercise);
	}
	return pickMesoExercises([...names]).filter((exercise) => mesoAnchor(meso, exercise, keyMaps) != null);
}

function exerciseInSession(
	exercise: string,
	sessionIndex: 0 | 1,
	templates: WorkoutTemplate[],
	day: TrainingDay | null,
	meso: MesocyclePlan,
	keyMaps: ExerciseKeyMaps
): boolean {
	if (day?.exercises.includes(exercise)) return true;
	const mesoSessions = meso.exerciseSessions?.[toExerciseId(exercise, keyMaps)];
	if (mesoSessions && mesoSessions.length > 0) {
		return mesoSessions.includes(sessionIndex);
	}
	const template = templates.find((item) => item.indexInMicro === sessionIndex);
	if (template && template.exercises.length > 0) {
		return template.exercises.includes(exercise);
	}
	return true;
}

export function buildProtocolMatrix(
	mesoPlan: MesocyclePlan,
	microPlans: MicrocyclePlan[],
	cyclePlan: CyclePlan,
	anchorInfo: Record<string, ExerciseAnchorInfo>,
	entries: WorkoutEntry[],
	keyMaps: ExerciseKeyMaps,
	options: BuildProtocolMatrixOptions = {}
): ProtocolMatrixRow[] {
	const { microViews = [], workoutTemplates = [] } = options;
	const microViewByIndex = new Map(microViews.map((micro) => [micro.plan.indexInMeso, micro]));

	return sortExercisesByAnchorDesc(Object.keys(anchorInfo), anchorInfo).map((exercise) => {
			const template = templateForExercise(cyclePlan, mesoPlan, exercise, keyMaps);
			const anchor = anchorInfo[exercise].anchor;
			const cells: ProtocolMatrixCell[] = [];

			for (const micro of microPlans) {
				const microView = microViewByIndex.get(micro.indexInMeso);
				for (const sessionIndex of [0, 1] as const) {
					const day = sessionIndex === 0 ? (microView?.dayA ?? null) : (microView?.dayB ?? null);
					const date = day?.date ?? null;
					const applicable = exerciseInSession(
						exercise,
						sessionIndex,
						workoutTemplates,
						day,
						mesoPlan,
						keyMaps
					);
					const { pct, phase } = targetPctForExercise(cyclePlan, mesoPlan, micro, exercise, keyMaps);
					let factMaxPct: number | null = null;
					let factMaxWeight: number | null = null;
					let plannedOnly = true;

					if (applicable && pct != null && pct > 0 && anchor) {
						const entry = date
							? entries
									.filter((item) => item.exercise === exercise && item.date === date)
									.sort((a, b) => b.date.localeCompare(a.date))[0]
							: entries
									.filter((item) => item.exercise === exercise && microHasDate(micro, item.date))
									.sort((a, b) => b.date.localeCompare(a.date))[0];

						if (entry?.sets.length) {
							const row = sessionIntensity(entry, anchor, pct);
							if (row) {
								factMaxPct = row.maxPct;
								factMaxWeight = row.maxWeight;
								plannedOnly = false;
							}
						}
					}

					cells.push({
						microIndex: micro.indexInMeso,
						sessionIndex,
						date,
						applicable,
						pct: applicable ? pct : null,
						label: applicable ? (phase?.label ?? null) : null,
						targetWeight:
							applicable && pct != null && pct > 0 && anchor ? targetWeight(anchor, pct) : null,
						factMaxPct: applicable ? factMaxPct : null,
						factMaxWeight: applicable ? factMaxWeight : null,
						plannedOnly
					});
				}
			}

			return {
				exercise,
				anchor,
				templateName: template.name,
				cells
			};
		});
}

export function exerciseTargetOnMicro(
	cyclePlan: CyclePlan,
	meso: MesocyclePlan,
	micro: MicrocyclePlan,
	exercise: string,
	anchor: number,
	keyMaps: ExerciseKeyMaps,
	entry?: WorkoutEntry
): ReturnType<typeof sessionIntensity> | null {
	const { pct, phase, template } = targetPctForExercise(cyclePlan, meso, micro, exercise, keyMaps);
	if (pct == null || pct <= 0 || !anchor) return null;
	const label = phase ? `${template.name} · ${phase.label}` : template.name;
	if (entry?.sets.length) {
		const row = sessionIntensity(entry, anchor, pct);
		if (!row) return null;
		row.protocolLabel = label;
		return row;
	}
	return plannedSessionIntensity(exercise, anchor, pct, label);
}

export function importPlanFromAuto(
	overview: MicrocycleOverview,
	entries: WorkoutEntry[],
	existing?: CyclePlan | null
): CyclePlan {
	const keyMaps = buildExerciseKeyMapsFromEntries(entries);
	const templates = existing?.templates?.length
		? ensureBundledProtocols({ ...existing, templates: existing.templates, mesocycles: existing.mesocycles ?? [] })
				.templates
		: bundledProtocolTemplates();
	const defaultTemplateId = templates[0].id;

	const mesocycles: MesocyclePlan[] = overview.mesocycles.map((meso) => {
		const exercises = mesoExerciseNames(overview, meso.index);
		const anchor1rm = buildAnchor1rm(exercises, entries, meso.startDate, meso.endDate, keyMaps);
		const existingMeso = existing?.mesocycles.find(
			(item) => item.startDate === meso.startDate && item.endDate === meso.endDate
		);
		const exerciseProtocols = existingMeso?.exerciseProtocols ?? {};
		const hasStoredAnchors = Boolean(
			existingMeso && Object.keys(existingMeso.anchor1rm).length > 0
		);

		return {
			id: existingMeso?.id ?? newId('meso'),
			label: meso.label,
			startDate: meso.startDate,
			endDate: meso.endDate,
			templateId: existingMeso?.templateId ?? defaultTemplateId,
			anchor1rm: hasStoredAnchors ? existingMeso!.anchor1rm : anchor1rm,
			anchor1rmManual: existingMeso?.anchor1rmManual ?? {},
			exerciseProtocols,
			exerciseSessions: existingMeso?.exerciseSessions,
			microcycles: meso.microcycles.map((micro, index) =>
				microFromOverviewDays(
					existingMeso?.microcycles[index]?.id ?? newId('micro'),
					micro.indexInMeso,
					micro.days
				)
			)
		};
	});

	return {
		version: 4,
		revision: (existing?.revision ?? 0) + 1,
		updatedAt: new Date().toISOString(),
		templates,
		macrocycles: existing?.macrocycles ?? [],
		mesocycles
	};
}

function templateById(plan: CyclePlan, id: string): ProtocolTemplate {
	return plan.templates.find((item) => item.id === id) ?? plan.templates[0];
}

function dayFromOverview(byDate: Map<string, TrainingDay>, date: string): TrainingDay | null {
	return byDate.get(date) ?? null;
}

function trainingDayFromSession(
	session: MicroSessionPlan | undefined,
	byDate: Map<string, TrainingDay>
): TrainingDay | null {
	if (!session?.date) return null;
	return (
		byDate.get(session.date) ?? {
			date: session.date,
			exercises: [],
			indexInMicro: session.indexInMicro,
			confidence: 1
		}
	);
}

function enrichMicro(
	plan: MicrocyclePlan,
	meso: MesocyclePlan,
	cyclePlan: CyclePlan,
	defaultTemplate: ProtocolTemplate,
	byDate: Map<string, TrainingDay>,
	entries: WorkoutEntry[],
	keyMaps: ExerciseKeyMaps
): EnrichedMicrocycle {
	const dayA = trainingDayFromSession(sessionPlanByIndex(plan, 0), byDate);
	const dayB = trainingDayFromSession(sessionPlanByIndex(plan, 1), byDate);
	const defaultPhase = phaseForMicro(defaultTemplate, plan.indexInMeso);
	const targetPct = plan.intensityPct ?? defaultPhase?.intensityPct ?? null;

	const intensityByExercise: NonNullable<ReturnType<typeof sessionIntensity>>[] = [];
	const microExercises = exercisesInMicro(plan, dayA, dayB, meso, entries, keyMaps);

	for (const exercise of microExercises) {
		const anchor = mesoAnchor(meso, exercise, keyMaps);
		if (anchor == null) continue;

		const entry = entries
			.filter((item) => item.exercise === exercise && microHasDate(plan, item.date))
			.sort((a, b) => b.date.localeCompare(a.date))[0];

		const row = exerciseTargetOnMicro(
			cyclePlan,
			meso,
			plan,
			exercise,
			anchor,
			keyMaps,
			entry ?? undefined
		);
		if (row) intensityByExercise.push(row);
	}

	intensityByExercise.sort((a, b) => (a?.exercise ?? '').localeCompare(b?.exercise ?? '', 'ru'));

	return {
		plan,
		dayA,
		dayB,
		complete: Boolean(dayA && dayB),
		phase: defaultPhase,
		targetPct,
		intensityByExercise
	};
}

function reindexMeso(meso: MesocyclePlan): MesocyclePlan {
	const microcycles = [...meso.microcycles]
		.sort((a, b) => a.indexInMeso - b.indexInMeso)
		.map((micro, index) => ({ ...micro, indexInMeso: index + 1 }));
	const allDates = microcycles.flatMap((micro) => microDates(micro)).sort();
	return {
		...meso,
		microcycles,
		startDate: allDates[0] ?? meso.startDate,
		endDate: allDates[allDates.length - 1] ?? meso.endDate
	};
}

function enrichSingleMesocycle(
	meso: MesocyclePlan,
	index: number,
	plan: CyclePlan,
	overview: MicrocycleOverview,
	entries: WorkoutEntry[],
	keyMaps: ExerciseKeyMaps
): EnrichedMesocycle {
	const template = templateById(plan, meso.templateId);
	const normalized = reindexMeso(withComputedAnchors(meso, entries, keyMaps));
	const anchorInfo = buildAnchorInfo(normalized, entries, keyMaps);
	const effectiveMeso: MesocyclePlan = {
		...normalized,
		anchor1rm: Object.fromEntries(
			Object.entries(anchorInfo).map(([exercise, meta]) => [
				toExerciseId(exercise, keyMaps),
				meta.anchor
			])
		)
	};
	const microcycles = normalized.microcycles.map((micro) =>
		enrichMicro(micro, effectiveMeso, plan, template, overview.byDate, entries, keyMaps)
	);
	const allMicroDates = normalized.microcycles.flatMap((m) => microDates(m)).sort();
	const startDate = allMicroDates[0] ?? normalized.startDate;
	const endDate =
		allMicroDates[allMicroDates.length - 1] ?? (normalized.endDate || startDate);

	return {
		plan: { ...effectiveMeso, startDate, endDate },
		template,
		index,
		anchorInfo,
		protocolMatrix: buildProtocolMatrix(
			effectiveMeso,
			normalized.microcycles,
			plan,
			anchorInfo,
			entries,
			keyMaps,
			{ microViews: microcycles, workoutTemplates: overview.templates }
		),
		microcycles,
		completeMicrocycles: microcycles.filter((m) => m.complete).length,
		durationDays: startDate && endDate ? daysBetween(startDate, endDate) : 0,
		gapAfterDays: null
	};
}

export function buildCyclePlanView(
	plan: CyclePlan | null,
	overview: MicrocycleOverview,
	entries: WorkoutEntry[],
	allDates: string[],
	exercises: Exercise[] = []
): CyclePlanView {
	if (!plan || plan.mesocycles.length === 0) {
		return {
			plan,
			macrocycles: [],
			mesocycles: [],
			orphanMesocycles: [],
			unassignedDates: allDates,
			usingManualPlan: false
		};
	}

	const keyMaps = buildWorkoutKeyMaps(exercises, entries);

	const assigned = new Set(
		plan.mesocycles.flatMap((meso) => meso.microcycles.flatMap((m) => microDates(m)))
	);
	const unassignedDates = allDates.filter((date) => !assigned.has(date));

	const enrichedById = new Map(
		plan.mesocycles.map((meso, index) => [
			meso.id,
			enrichSingleMesocycle(meso, index + 1, plan, overview, entries, keyMaps)
		])
	);

	const orphanMesocycles: EnrichedMesocycle[] = [];
	const macrocycles: EnrichedMacrocycle[] = plan.macrocycles.map((macro, macroIndex) => {
		const mesocycles = macro.mesoIds
			.map((id) => enrichedById.get(id))
			.filter((m): m is EnrichedMesocycle => m != null);

		for (let i = 0; i < mesocycles.length - 1; i++) {
			mesocycles[i].gapAfterDays = daysBetween(
				mesocycles[i].plan.endDate,
				mesocycles[i + 1].plan.startDate
			);
		}

		const macroDates = mesocycles.flatMap((m) =>
			m.microcycles.flatMap((micro) => microDates(micro.plan))
		);
		const startDate = macroDates.sort()[0] ?? macro.startDate;
		const endDate = macroDates.sort().slice(-1)[0] ?? macro.endDate;

		return {
			plan: { ...macro, startDate, endDate },
			index: macroIndex + 1,
			mesocycles,
			durationDays: startDate && endDate ? daysBetween(startDate, endDate) : 0,
			gapAfterDays: null
		};
	});

	for (const meso of enrichedById.values()) {
		const inMacro = plan.macrocycles.some((macro) => macro.mesoIds.includes(meso.plan.id));
		if (!inMacro) orphanMesocycles.push(meso);
	}

	for (let i = 0; i < macrocycles.length - 1; i++) {
		macrocycles[i].gapAfterDays = daysBetween(
			macrocycles[i].plan.endDate,
			macrocycles[i + 1].plan.startDate
		);
	}

	for (let i = 0; i < orphanMesocycles.length - 1; i++) {
		orphanMesocycles[i].gapAfterDays = daysBetween(
			orphanMesocycles[i].plan.endDate,
			orphanMesocycles[i + 1].plan.startDate
		);
	}

	const mesocycles = [...macrocycles.flatMap((m) => m.mesocycles), ...orphanMesocycles];

	return {
		plan,
		macrocycles,
		mesocycles,
		orphanMesocycles,
		unassignedDates,
		usingManualPlan: true
	};
}

export function mesocyclePlanForDate(view: CyclePlanView, date: string): EnrichedMesocycle | null {
	return (
		view.mesocycles.find((meso) => date >= meso.plan.startDate && date <= meso.plan.endDate) ??
		null
	);
}

export function microcyclePlanForDate(
	meso: EnrichedMesocycle,
	date: string
): EnrichedMicrocycle | null {
	return meso.microcycles.find((micro) => microHasDate(micro.plan, date)) ?? null;
}

export function exercisesForMicroSession(
	meso: EnrichedMesocycle,
	templates: WorkoutTemplate[],
	indexInMicro: 0 | 1,
	keyMaps?: ExerciseKeyMaps
): string[] {
	const inMeso = new Set(Object.keys(meso.anchorInfo));
	const sessions = meso.plan.exerciseSessions;
	if (sessions && keyMaps) {
		const fromPlan = Object.entries(sessions)
			.filter(([, slots]) => slots.includes(indexInMicro))
			.map(([exerciseId]) => keyMaps.nameById.get(exerciseId) ?? exerciseId)
			.filter((exercise) => inMeso.has(exercise));
		if (fromPlan.length) return pickMesoExercises(fromPlan);
	}
	const template = templates.find((item) => item.indexInMicro === indexInMicro);
	if (!template) return [];
	return template.exercises.filter((exercise) => inMeso.has(exercise));
}

/** @deprecated используй exercisesForMicroSession */
export function exercisesForWorkoutSlot(
	meso: EnrichedMesocycle,
	templates: WorkoutTemplate[],
	slot: 'A' | 'B' | 'unknown'
): string[] {
	const index = slot === 'B' ? 1 : 0;
	return exercisesForMicroSession(meso, templates, index);
}

export function suggestSessionIndex(
	micro: EnrichedMicrocycle,
	date: string,
	entries: WorkoutEntry[],
	templates: WorkoutTemplate[]
): number {
	const dayEntries = entries.filter((entry) => entry.date === date);
	const template0 = templates.find((item) => item.indexInMicro === 0);
	const template1 = templates.find((item) => item.indexInMicro === 1);

	if (dayEntries.length > 0 && template0 && template1) {
		const todayExercises = new Set(dayEntries.map((entry) => entry.exercise));
		const score0 = template0.exercises.filter((exercise) => todayExercises.has(exercise)).length;
		const score1 = template1.exercises.filter((exercise) => todayExercises.has(exercise)).length;
		return score0 >= score1 ? 0 : 1;
	}

	if (micro.dayA && !micro.dayB) return 1;
	if (micro.dayB && !micro.dayA) return 0;
	return 0;
}

/** @deprecated используй suggestSessionIndex */
export function suggestWorkoutSlot(
	micro: EnrichedMicrocycle,
	date: string,
	entries: WorkoutEntry[],
	templates: WorkoutTemplate[]
): 'A' | 'B' | 'unknown' {
	const index = suggestSessionIndex(micro, date, entries, templates);
	return index === 1 ? 'B' : 'A';
}

export function resolveMesoMicroSelection(
	mesocycles: EnrichedMesocycle[],
	date: string,
	mesoId: string | null,
	microId: string | null
): { meso: EnrichedMesocycle; micro: EnrichedMicrocycle } | null {
	if (mesocycles.length === 0) return null;

	if (mesoId && microId) {
		const meso = mesocycles.find((item) => item.plan.id === mesoId);
		const micro = meso?.microcycles.find((item) => item.plan.id === microId);
		if (meso && micro) return { meso, micro };
	}

	if (mesoId) {
		const meso = mesocycles.find((item) => item.plan.id === mesoId);
		if (meso) {
			const micro =
				(microId && meso.microcycles.find((item) => item.plan.id === microId)) ??
				meso.microcycles.find((item) => microHasDate(item.plan, date)) ??
				meso.microcycles.find((item) => !item.complete) ??
				meso.microcycles[meso.microcycles.length - 1];
			if (micro) return { meso, micro };
		}
	}

	for (const meso of mesocycles) {
		const micro = meso.microcycles.find((item) => microHasDate(item.plan, date));
		if (micro) return { meso, micro };
	}

	const mesoByDate = mesocycles.find(
		(meso) => date >= meso.plan.startDate && date <= meso.plan.endDate
	);
	if (mesoByDate) {
		if (microId) {
			const micro = mesoByDate.microcycles.find((item) => item.plan.id === microId);
			if (micro) return { meso: mesoByDate, micro };
		}
		const incomplete = mesoByDate.microcycles.find((item) => !item.complete);
		if (incomplete) return { meso: mesoByDate, micro: incomplete };
		const last = mesoByDate.microcycles[mesoByDate.microcycles.length - 1];
		if (last) return { meso: mesoByDate, micro: last };
	}

	return null;
}

/** Текущий активный μ — последний мезо, первый неполный микро (только для «сегодня»). */
export function defaultActiveMesoMicro(
	mesocycles: EnrichedMesocycle[]
): { meso: EnrichedMesocycle; micro: EnrichedMicrocycle } | null {
	if (mesocycles.length === 0) return null;
	const meso = mesocycles[mesocycles.length - 1];
	const incomplete = meso.microcycles.find((item) => !item.complete);
	const micro = incomplete ?? meso.microcycles[meso.microcycles.length - 1];
	return micro ? { meso, micro } : null;
}

/** Восстановить распределение дней по μ из автоопределения (не трогает 1ПМ и протоколы). */
export function repairMicroDatesFromAuto(
	plan: CyclePlan,
	overview: MicrocycleOverview
): CyclePlan {
	const autoOrdered = [...overview.mesocycles].sort((a, b) =>
		a.startDate.localeCompare(b.startDate)
	);
	const manualOrdered = [...plan.mesocycles].sort((a, b) =>
		a.startDate.localeCompare(b.startDate)
	);

	const mesocycles = plan.mesocycles.map((meso) => {
		const manualIndex = manualOrdered.findIndex((item) => item.id === meso.id);
		const autoMeso = autoOrdered[manualIndex];
		if (!autoMeso) return meso;

		const microcycles = autoMeso.microcycles.map((micro, idx) =>
			microFromOverviewDays(
				meso.microcycles[idx]?.id ?? newId('micro'),
				micro.indexInMeso,
				micro.days
			)
		);

		return reindexMeso({
			...meso,
			startDate: autoMeso.startDate,
			endDate: autoMeso.endDate,
			microcycles
		});
	});

	return touchPlan({ ...plan, mesocycles });
}

/** Привязать дату тренировки к элементу μ, если ещё не распределена. */
export function assignSessionToMicro(
	plan: CyclePlan,
	mesoId: string,
	microId: string,
	date: string,
	indexInMicro?: number
): CyclePlan {
	const meso = plan.mesocycles.find((item) => item.id === mesoId);
	const micro = meso?.microcycles.find((item) => item.id === microId);
	if (!micro || microHasDate(micro, date)) return plan;
	return assignSessionDate(plan, mesoId, microId, date, indexInMicro);
}

export function createMesocycle(plan: CyclePlan, label = 'Новый блок'): CyclePlan {
	const meso: MesocyclePlan = {
		id: newId('meso'),
		label,
		startDate: '',
		endDate: '',
		templateId: plan.templates[0]?.id ?? DEFAULT_PROTOCOL_TEMPLATE.id,
		anchor1rm: {},
		microcycles: [
			{ id: newId('micro'), indexInMeso: 1, sessions: defaultMicroSessions() },
			{ id: newId('micro'), indexInMeso: 2, sessions: defaultMicroSessions() }
		]
	};
	return touchPlan({ ...plan, mesocycles: [...plan.mesocycles, meso] });
}

export function addMicrocycle(plan: CyclePlan, mesoId: string): CyclePlan {
	return touchPlan({
		...plan,
		mesocycles: plan.mesocycles.map((meso) => {
			if (meso.id !== mesoId) return meso;
			const nextIndex = meso.microcycles.length + 1;
			return reindexMeso({
				...meso,
				microcycles: [
					...meso.microcycles,
					{ id: newId('micro'), indexInMeso: nextIndex, sessions: defaultMicroSessions() }
				]
			});
		})
	});
}

export function removeMicrocycle(plan: CyclePlan, mesoId: string, microId: string): CyclePlan {
	return touchPlan({
		...plan,
		mesocycles: plan.mesocycles.map((meso) => {
			if (meso.id !== mesoId) return meso;
			return reindexMeso({
				...meso,
				microcycles: meso.microcycles.filter((micro) => micro.id !== microId)
			});
		})
	});
}

export function updateMesocycle(
	plan: CyclePlan,
	mesoId: string,
	patch: Partial<Pick<MesocyclePlan, 'label' | 'templateId' | 'anchor1rm' | 'exerciseProtocols' | 'anchor1rmManual'>>
): CyclePlan {
	return touchPlan({
		...plan,
		mesocycles: plan.mesocycles.map((meso) => (meso.id === mesoId ? { ...meso, ...patch } : meso))
	});
}

export function assignSessionDate(
	plan: CyclePlan,
	mesoId: string,
	microId: string,
	date: string,
	indexInMicro?: number
): CyclePlan {
	const cleaned = unassignSessionDate(plan, date);
	return touchPlan({
		...cleaned,
		mesocycles: cleaned.mesocycles.map((meso) => {
			if (meso.id !== mesoId) return meso;
			return reindexMeso({
				...meso,
				microcycles: meso.microcycles.map((micro) => {
					if (micro.id !== microId) return micro;
					const sessions: MicrocyclePlan['sessions'] = [
						{ ...micro.sessions[0] },
						{ ...micro.sessions[1] }
					];
					let idx =
						indexInMicro ??
						sessions.findIndex((session) => !session.date);
					if (idx < 0) idx = sessions.length - 1;
					return {
						...micro,
						sessions: [
							idx === 0
								? { ...sessions[0], date }
								: sessions[0].date === date
									? { ...sessions[0], date: undefined }
									: sessions[0],
							idx === 1
								? { ...sessions[1], date }
								: sessions[1].date === date
									? { ...sessions[1], date: undefined }
									: sessions[1]
						]
					};
				})
			});
		})
	});
}

/** @deprecated используй assignSessionDate */
export function assignDate(
	plan: CyclePlan,
	mesoId: string,
	microId: string,
	date: string
): CyclePlan {
	return assignSessionDate(plan, mesoId, microId, date);
}

export function unassignSessionDate(plan: CyclePlan, date: string): CyclePlan {
	return touchPlan({
		...plan,
		mesocycles: plan.mesocycles.map((meso) =>
			reindexMeso({
				...meso,
				microcycles: meso.microcycles.map((micro) => ({
					...micro,
					sessions: [
						micro.sessions[0].date === date
							? { ...micro.sessions[0], date: undefined }
							: micro.sessions[0],
						micro.sessions[1].date === date
							? { ...micro.sessions[1], date: undefined }
							: micro.sessions[1]
					]
				}))
			})
		)
	});
}

/** @deprecated используй unassignSessionDate */
export function unassignDate(plan: CyclePlan, date: string): CyclePlan {
	return unassignSessionDate(plan, date);
}

export function updateMicroIntensity(
	plan: CyclePlan,
	mesoId: string,
	microId: string,
	intensityPct: number | undefined
): CyclePlan {
	return touchPlan({
		...plan,
		mesocycles: plan.mesocycles.map((meso) => {
			if (meso.id !== mesoId) return meso;
			return {
				...meso,
				microcycles: meso.microcycles.map((micro) =>
					micro.id === microId ? { ...micro, intensityPct } : micro
				)
			};
		})
	});
}

export function updateExerciseProtocol(
	plan: CyclePlan,
	mesoId: string,
	exercise: string,
	templateId: string | null,
	keyMaps: ExerciseKeyMaps
): CyclePlan {
	const id = toExerciseId(exercise, keyMaps);
	return touchPlan({
		...plan,
		mesocycles: plan.mesocycles.map((meso) => {
			if (meso.id !== mesoId) return meso;
			const exerciseProtocols = { ...(meso.exerciseProtocols ?? {}) };
			if (!templateId || templateId === meso.templateId) {
				delete exerciseProtocols[id];
			} else {
				exerciseProtocols[id] = templateId;
			}
			return { ...meso, exerciseProtocols };
		})
	});
}

export function syncMesoExercises(
	plan: CyclePlan,
	mesoId: string,
	exerciseNames: string[],
	entries: WorkoutEntry[],
	startDate: string,
	endDate: string,
	keyMaps: ExerciseKeyMaps
): CyclePlan {
	return touchPlan({
		...plan,
		mesocycles: plan.mesocycles.map((meso) => {
			if (meso.id !== mesoId) return meso;
			const anchor1rm = { ...meso.anchor1rm };
			const anchor1rmManual = { ...(meso.anchor1rmManual ?? {}) };
			for (const exercise of pickMesoExercises(exerciseNames)) {
				const id = toExerciseId(exercise, keyMaps);
				if (anchor1rmManual[id]) continue;
				const resolved = resolveMesoAnchor1rm(entries, exercise, startDate, endDate);
				if (resolved) anchor1rm[id] = resolved.value;
			}
			return { ...meso, anchor1rm, anchor1rmManual };
		})
	});
}

/** Пересчитать якорные 1ПМ из данных; вручную заданные можно сохранить. */
export function refreshAllMesoAnchors(
	plan: CyclePlan,
	entries: WorkoutEntry[],
	keepManual = true,
	keyMaps?: ExerciseKeyMaps
): CyclePlan {
	const maps = keyMaps ?? buildExerciseKeyMapsFromEntries(entries);
	return touchPlan({
		...plan,
		mesocycles: plan.mesocycles.map((meso) => {
			const normalized = reindexMeso(meso);
			const anchor1rmManual = keepManual ? { ...(normalized.anchor1rmManual ?? {}) } : {};
			const exercises = mesoExercisesFromPlan(normalized, entries, maps);
			const anchor1rm: Record<string, number> = {};

			for (const exercise of exercises) {
				const id = toExerciseId(exercise, maps);
				if (keepManual && anchor1rmManual[id] && normalized.anchor1rm[id] != null) {
					anchor1rm[id] = normalized.anchor1rm[id];
					continue;
				}
				delete anchor1rmManual[id];
				const resolved = resolveMesoAnchor1rm(
					entries,
					exercise,
					normalized.startDate,
					normalized.endDate
				);
				if (resolved) anchor1rm[id] = resolved.value;
			}

			return { ...normalized, anchor1rm, anchor1rmManual };
		})
	});
}

export function markAnchorManual(
	plan: CyclePlan,
	mesoId: string,
	exercise: string,
	value: number,
	keyMaps: ExerciseKeyMaps
): CyclePlan {
	const id = toExerciseId(exercise, keyMaps);
	return touchPlan({
		...plan,
		mesocycles: plan.mesocycles.map((meso) => {
			if (meso.id !== mesoId) return meso;
			return {
				...meso,
				anchor1rm: { ...meso.anchor1rm, [id]: value },
				anchor1rmManual: { ...(meso.anchor1rmManual ?? {}), [id]: true }
			};
		})
	});
}

export function removeExerciseFromMeso(
	plan: CyclePlan,
	mesoId: string,
	exercise: string,
	keyMaps: ExerciseKeyMaps
): CyclePlan {
	const id = toExerciseId(exercise, keyMaps);
	return touchPlan({
		...plan,
		mesocycles: plan.mesocycles.map((meso) => {
			if (meso.id !== mesoId) return meso;
			const anchor1rm = { ...meso.anchor1rm };
			delete anchor1rm[id];
			const anchor1rmManual = { ...(meso.anchor1rmManual ?? {}) };
			delete anchor1rmManual[id];
			const exerciseProtocols = { ...(meso.exerciseProtocols ?? {}) };
			delete exerciseProtocols[id];
			const exerciseSessions = { ...(meso.exerciseSessions ?? {}) };
			delete exerciseSessions[id];
			return { ...meso, anchor1rm, anchor1rmManual, exerciseProtocols, exerciseSessions };
		})
	});
}

/** Добавить упражнение из каталога в мезоцикл (якорь из истории или вручную). */
export function addExerciseToMeso(
	plan: CyclePlan,
	mesoId: string,
	exercise: string,
	entries: WorkoutEntry[],
	keyMaps: ExerciseKeyMaps
): CyclePlan {
	const id = toExerciseId(exercise, keyMaps);
	return touchPlan({
		...plan,
		mesocycles: plan.mesocycles.map((meso) => {
			if (meso.id !== mesoId) return meso;
			if (meso.anchor1rm[id] != null) return meso;

			const resolved = resolveMesoAnchor1rm(entries, exercise, meso.startDate, meso.endDate);
			const anchor1rm = { ...meso.anchor1rm };
			if (resolved) {
				anchor1rm[id] = resolved.value;
				return { ...meso, anchor1rm };
			}

			anchor1rm[id] = 0;
			return {
				...meso,
				anchor1rm,
				anchor1rmManual: { ...(meso.anchor1rmManual ?? {}), [id]: true },
				exerciseSessions: { ...(meso.exerciseSessions ?? {}), [id]: [0, 1] }
			};
		})
	});
}

/** Убрать упражнение из всех мезоциклов плана (якоря и протоколы). */
export function purgeExerciseFromPlan(plan: CyclePlan, exerciseId: string): CyclePlan {
	return touchPlan({
		...plan,
		mesocycles: plan.mesocycles.map((meso) => {
			const anchor1rm = { ...meso.anchor1rm };
			delete anchor1rm[exerciseId];
			const anchor1rmManual = { ...(meso.anchor1rmManual ?? {}) };
			delete anchor1rmManual[exerciseId];
			const exerciseProtocols = { ...(meso.exerciseProtocols ?? {}) };
			delete exerciseProtocols[exerciseId];
			const exerciseSessions = { ...(meso.exerciseSessions ?? {}) };
			delete exerciseSessions[exerciseId];
			return { ...meso, anchor1rm, anchor1rmManual, exerciseProtocols, exerciseSessions };
		})
	});
}

export function updateTemplate(plan: CyclePlan, template: ProtocolTemplate): CyclePlan {
	const templates = plan.templates.some((item) => item.id === template.id)
		? plan.templates.map((item) => (item.id === template.id ? template : item))
		: [...plan.templates, template];
	return touchPlan({ ...plan, templates });
}

export function createProtocolTemplate(plan: CyclePlan, name = 'Мой протокол'): CyclePlan {
	const id = newId('custom');
	const template: ProtocolTemplate = {
		id,
		name: name.trim() || 'Мой протокол',
		description: '',
		phases: [{ id: `${id}-w1`, label: 'Неделя 1', intensityPct: 70, microFrom: 1, microTo: 1 }]
	};
	return touchPlan({ ...plan, templates: [...plan.templates, template] });
}

export function duplicateProtocolTemplate(plan: CyclePlan, templateId: string): CyclePlan {
	const source = plan.templates.find((item) => item.id === templateId);
	if (!source) return plan;
	const id = newId('custom');
	const copy: ProtocolTemplate = {
		...structuredClone(source),
		id,
		name: `${source.name} (копия)`,
		phases: source.phases.map((phase, index) => ({
			...phase,
			id: `${id}-w${index + 1}`
		}))
	};
	return touchPlan({ ...plan, templates: [...plan.templates, copy] });
}

export function resetProtocolTemplate(plan: CyclePlan, templateId: string): CyclePlan {
	const bundled = bundledProtocolById(templateId);
	if (!bundled) return plan;
	return updateTemplate(plan, bundled);
}

export function removeProtocolTemplate(plan: CyclePlan, templateId: string): CyclePlan {
	if (!isCustomProtocolId(templateId)) return plan;
	const fallbackId = DEFAULT_PROTOCOL_TEMPLATE.id;
	return touchPlan({
		...plan,
		templates: plan.templates.filter((item) => item.id !== templateId),
		mesocycles: plan.mesocycles.map((meso) => {
			const templateIdForMeso =
				meso.templateId === templateId ? fallbackId : meso.templateId;
			const exerciseProtocols = { ...(meso.exerciseProtocols ?? {}) };
			for (const [exercise, protoId] of Object.entries(exerciseProtocols)) {
				if (protoId === templateId) exerciseProtocols[exercise] = fallbackId;
			}
			return { ...meso, templateId: templateIdForMeso, exerciseProtocols };
		})
	});
}

export function addProtocolPhase(plan: CyclePlan, templateId: string): CyclePlan {
	const template = plan.templates.find((item) => item.id === templateId);
	if (!template) return plan;
	const nextMicro = template.phases.length + 1;
	const phase: ProtocolPhase = {
		id: `${templateId}-w${nextMicro}`,
		label: `Неделя ${nextMicro}`,
		intensityPct: template.phases[template.phases.length - 1]?.intensityPct ?? 70,
		microFrom: nextMicro,
		microTo: nextMicro
	};
	return updateTemplate(plan, { ...template, phases: [...template.phases, phase] });
}

export function removeProtocolPhase(
	plan: CyclePlan,
	templateId: string,
	phaseIndex: number
): CyclePlan {
	const template = plan.templates.find((item) => item.id === templateId);
	if (!template || template.phases.length <= 1) return plan;
	const phases = template.phases
		.filter((_, index) => index !== phaseIndex)
		.map((phase, index) => ({
			...phase,
			id: `${templateId}-w${index + 1}`,
			microFrom: index + 1,
			microTo: index + 1
		}));
	return updateTemplate(plan, { ...template, phases });
}

export function removeMesocycle(plan: CyclePlan, mesoId: string): CyclePlan {
	const meso = plan.mesocycles.find((item) => item.id === mesoId);
	return touchPlan({
		...plan,
		macrocycles: (plan.macrocycles ?? []).map((macro) => ({
			...macro,
			mesoIds: macro.mesoIds.filter((id) => id !== mesoId)
		})),
		mesocycles: plan.mesocycles.filter((item) => item.id !== mesoId)
	});
}

export function removeMacrocycle(plan: CyclePlan, macroId: string): CyclePlan {
	const macro = (plan.macrocycles ?? []).find((item) => item.id === macroId);
	if (!macro) return plan;
	const drop = new Set(macro.mesoIds);
	return touchPlan({
		...plan,
		macrocycles: plan.macrocycles.filter((item) => item.id !== macroId),
		mesocycles: plan.mesocycles.filter((item) => !drop.has(item.id))
	});
}

export function updateMacrocycle(
	plan: CyclePlan,
	macroId: string,
	patch: Partial<Pick<MacrocyclePlan, 'label' | 'note' | 'startDate' | 'endDate'>>
): CyclePlan {
	return touchPlan({
		...plan,
		macrocycles: (plan.macrocycles ?? []).map((macro) =>
			macro.id === macroId ? { ...macro, ...patch } : macro
		)
	});
}

function touchPlan(plan: CyclePlan): CyclePlan {
	return {
		...plan,
		revision: plan.revision + 1,
		updatedAt: new Date().toISOString()
	};
}

/** Fallback: auto mesocycles as read-only enriched view when no manual plan. */
export function autoMesocyclesAsView(
	overview: MicrocycleOverview,
	entries: WorkoutEntry[]
): EnrichedMesocycle[] {
	const keyMaps = buildExerciseKeyMapsFromEntries(entries);
	const templates = bundledProtocolTemplates();
	const cyclePlan: CyclePlan = {
		version: 4,
		revision: 0,
		updatedAt: '',
		templates: templates.map((item) => structuredClone(item)),
		macrocycles: [],
		mesocycles: []
	};
	const defaultTemplate = DEFAULT_PROTOCOL_TEMPLATE;

	return overview.mesocycles.map((meso, index) => {
		const exercises = mesoExerciseNames(overview, meso.index);
		const anchor1rm = buildAnchor1rm(exercises, entries, meso.startDate, meso.endDate, keyMaps);

		const plan: MesocyclePlan = {
			id: `auto-${meso.index}`,
			label: meso.label,
			startDate: meso.startDate,
			endDate: meso.endDate,
			templateId: defaultTemplate.id,
			anchor1rm,
			anchor1rmManual: {},
			exerciseProtocols: {},
			microcycles: meso.microcycles.map((micro) =>
				microFromOverviewDays(`auto-micro-${micro.index}`, micro.indexInMeso, micro.days)
			)
		};

		const microcycles = plan.microcycles.map((microPlan) =>
			enrichMicro(microPlan, plan, cyclePlan, defaultTemplate, overview.byDate, entries, keyMaps)
		);
		const anchorInfo = buildAnchorInfo(plan, entries, keyMaps);

		return {
			plan,
			template: defaultTemplate,
			index: index + 1,
			anchorInfo,
			protocolMatrix: buildProtocolMatrix(
				plan,
				plan.microcycles,
				cyclePlan,
				anchorInfo,
				entries,
				keyMaps,
				{ microViews: microcycles, workoutTemplates: overview.templates }
			),
			microcycles,
			completeMicrocycles: meso.completeMicrocycles,
			durationDays: meso.durationDays,
			gapAfterDays: meso.gapAfterDays
		};
	});
}
