import { dateToMs } from './chart-time';
import {
	bundledProtocolTemplates,
	bundledProtocolById,
	DEFAULT_PROTOCOL_TEMPLATE,
	type MesoAnchor1rm,
	type ProtocolPhase,
	type ProtocolTemplate,
	best1rmInRange,
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
import type { MicrocycleOverview, TrainingDay } from './microcycle';
import type { WorkoutEntry } from './types';

export type { ProtocolPhase, ProtocolTemplate };
export { DEFAULT_PROTOCOL_TEMPLATE, bundledProtocolTemplates, phaseForMicro, targetWeight } from './protocol';

export type MicrocyclePlan = {
	id: string;
	indexInMeso: number;
	dates: string[];
	label?: string;
	/** Переопределение %1ПМ для этого микро (иначе из фазы протокола). */
	intensityPct?: number;
};

export type MesocyclePlan = {
	id: string;
	label: string;
	startDate: string;
	endDate: string;
	microcycles: MicrocyclePlan[];
	/** Принадлежность макроциклу. */
	macroId?: string;
	/** Протокол по умолчанию для упражнений без своего шаблона. */
	templateId: string;
	/** Якорные 1ПМ на старт мезо: упражнение → кг. */
	anchor1rm: Record<string, number>;
	/** Упражнения с вручную заданным якорем — не пересчитываются автоматически. */
	anchor1rmManual?: Record<string, boolean>;
	/** Свой протокол для упражнения (id шаблона). Пусто → templateId мезо. */
	exerciseProtocols?: Record<string, string>;
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
	version: 1;
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
	intensityByExercise: ReturnType<typeof sessionIntensity>[];
};

export type ProtocolMatrixCell = {
	microIndex: number;
	pct: number | null;
	label: string | null;
	targetWeight: number | null;
	factMaxPct: number | null;
	factMaxWeight: number | null;
	plannedOnly: boolean;
};

export type ProtocolMatrixRow = {
	exercise: string;
	anchor: number;
	templateName: string;
	cells: ProtocolMatrixCell[];
};

export type ExerciseAnchorInfo = {
	anchor: number;
	source: MesoAnchor1rm['source'];
	anchorDate: string | null;
	peakInMeso: number | null;
	peakDate: string | null;
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
		version: 1,
		updatedAt: '',
		templates: bundledProtocolTemplates(),
		macrocycles: [],
		mesocycles: []
	};
}

/** Миграция и протоколы из каталога. */
export function normalizeCyclePlan(plan: CyclePlan): CyclePlan {
	const withProtocols = ensureBundledProtocols({
		...plan,
		macrocycles: plan.macrocycles ?? []
	});
	return withProtocols;
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

	return touchPlan({ ...plan, templates: ordered });
}

function mesoExercisesFromPlan(meso: MesocyclePlan, entries: WorkoutEntry[]): string[] {
	const names = new Set(Object.keys(meso.anchor1rm));
	const dates = new Set(meso.microcycles.flatMap((micro) => micro.dates));
	for (const entry of entries) {
		if (dates.has(entry.date)) names.add(entry.exercise);
	}
	return pickMesoExercises([...names]);
}

function buildAnchorInfo(
	meso: MesocyclePlan,
	entries: WorkoutEntry[]
): Record<string, ExerciseAnchorInfo> {
	const info: Record<string, ExerciseAnchorInfo> = {};
	for (const exercise of mesoExercisesFromPlan(meso, entries)) {
		const manual = Boolean(meso.anchor1rmManual?.[exercise]);
		const computed = resolveMesoAnchor1rm(entries, exercise, meso.startDate, meso.endDate);
		const peak = best1rmInRange(entries, exercise, meso.startDate, meso.endDate);
		const anchor =
			manual && meso.anchor1rm[exercise] != null
				? meso.anchor1rm[exercise]
				: computed?.value ?? meso.anchor1rm[exercise];

		if (anchor == null) continue;

		info[exercise] = {
			anchor,
			source: manual ? 'manual' : (computed?.source ?? 'prior'),
			anchorDate: manual ? null : (computed?.asOfDate ?? null),
			peakInMeso: peak?.value ?? null,
			peakDate: peak?.date ?? null,
			manual
		};
	}
	return info;
}

function withComputedAnchors(meso: MesocyclePlan, entries: WorkoutEntry[]): MesocyclePlan {
	const exercises = mesoExercisesFromPlan(meso, entries);
	const anchor1rm = { ...meso.anchor1rm };
	const anchor1rmManual = { ...(meso.anchor1rmManual ?? {}) };

	for (const exercise of exercises) {
		if (anchor1rmManual[exercise]) {
			if (anchor1rm[exercise] != null) continue;
		}
		const resolved = resolveMesoAnchor1rm(entries, exercise, meso.startDate, meso.endDate);
		if (resolved) anchor1rm[exercise] = resolved.value;
	}

	return { ...meso, anchor1rm, anchor1rmManual };
}

function buildAnchor1rm(
	exercises: string[],
	entries: WorkoutEntry[],
	startDate: string,
	endDate: string
): Record<string, number> {
	const anchor1rm: Record<string, number> = {};
	for (const exercise of exercises) {
		const resolved = resolveMesoAnchor1rm(entries, exercise, startDate, endDate);
		if (resolved) anchor1rm[exercise] = resolved.value;
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
	exercise: string
): ProtocolTemplate {
	const templateId = meso.exerciseProtocols?.[exercise] ?? meso.templateId;
	return plan.templates.find((item) => item.id === templateId) ?? plan.templates[0];
}

export function targetPctForExercise(
	plan: CyclePlan,
	meso: MesocyclePlan,
	micro: MicrocyclePlan,
	exercise: string
): { pct: number | null; phase: ProtocolPhase | null; template: ProtocolTemplate } {
	const template = templateForExercise(plan, meso, exercise);
	const phase = phaseForMicro(template, micro.indexInMeso);
	const pct = phase?.intensityPct ?? null;
	return { pct, phase, template };
}

export function exercisesInMicro(
	micro: MicrocyclePlan,
	dayA: TrainingDay | null,
	dayB: TrainingDay | null,
	meso: MesocyclePlan,
	entries: WorkoutEntry[]
): string[] {
	const names = new Set<string>();
	for (const day of [dayA, dayB]) {
		if (!day) continue;
		for (const exercise of day.exercises) names.add(exercise);
	}
	for (const entry of entries) {
		if (micro.dates.includes(entry.date)) names.add(entry.exercise);
	}
	return pickMesoExercises([...names]).filter((exercise) => meso.anchor1rm[exercise] != null);
}

export function buildProtocolMatrix(
	mesoPlan: MesocyclePlan,
	microPlans: MicrocyclePlan[],
	cyclePlan: CyclePlan,
	anchorInfo: Record<string, ExerciseAnchorInfo>,
	entries: WorkoutEntry[]
): ProtocolMatrixRow[] {
	return Object.keys(anchorInfo)
		.sort((a, b) => a.localeCompare(b, 'ru'))
		.map((exercise) => {
			const template = templateForExercise(cyclePlan, mesoPlan, exercise);
			const anchor = anchorInfo[exercise].anchor;
			const cells = microPlans.map((micro) => {
				const { pct, phase } = targetPctForExercise(cyclePlan, mesoPlan, micro, exercise);
				let factMaxPct: number | null = null;
				let factMaxWeight: number | null = null;
				let plannedOnly = true;

				if (pct != null && anchor) {
					const entry = entries
						.filter((item) => item.exercise === exercise && micro.dates.includes(item.date))
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

				return {
					microIndex: micro.indexInMeso,
					pct,
					label: phase?.label ?? null,
					targetWeight: pct != null && anchor ? targetWeight(anchor, pct) : null,
					factMaxPct,
					factMaxWeight,
					plannedOnly
				};
			});
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
	entry?: WorkoutEntry
): ReturnType<typeof sessionIntensity> | null {
	const { pct, phase, template } = targetPctForExercise(cyclePlan, meso, micro, exercise);
	if (pct == null || !anchor) return null;
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
	const templates = existing?.templates?.length
		? ensureBundledProtocols({ ...existing, templates: existing.templates, mesocycles: existing.mesocycles ?? [] })
				.templates
		: bundledProtocolTemplates();
	const defaultTemplateId = templates[0].id;

	const mesocycles: MesocyclePlan[] = overview.mesocycles.map((meso) => {
		const exercises = mesoExerciseNames(overview, meso.index);
		const anchor1rm = buildAnchor1rm(exercises, entries, meso.startDate, meso.endDate);
		const existingMeso = existing?.mesocycles.find(
			(item) => item.startDate === meso.startDate && item.endDate === meso.endDate
		);

		return {
			id: newId('meso'),
			label: meso.label,
			startDate: meso.startDate,
			endDate: meso.endDate,
			templateId: defaultTemplateId,
			anchor1rm,
			anchor1rmManual: {},
			exerciseProtocols: existingMeso?.exerciseProtocols ?? {},
			microcycles: meso.microcycles.map((micro) => ({
				id: newId('micro'),
				indexInMeso: micro.indexInMeso,
				dates: micro.days.map((day) => day.date).sort()
			}))
		};
	});

	return {
		version: 1,
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

function enrichMicro(
	plan: MicrocyclePlan,
	meso: MesocyclePlan,
	cyclePlan: CyclePlan,
	defaultTemplate: ProtocolTemplate,
	byDate: Map<string, TrainingDay>,
	entries: WorkoutEntry[]
): EnrichedMicrocycle {
	const days = plan.dates
		.map((date) => dayFromOverview(byDate, date))
		.filter((day): day is TrainingDay => day !== null);
	const dayA = days.find((day) => day.slot === 'A') ?? null;
	const dayB = days.find((day) => day.slot === 'B') ?? null;
	const defaultPhase = phaseForMicro(defaultTemplate, plan.indexInMeso);
	const targetPct = plan.intensityPct ?? defaultPhase?.intensityPct ?? null;

	const intensityByExercise: ReturnType<typeof sessionIntensity>[] = [];
	const microExercises = exercisesInMicro(plan, dayA, dayB, meso, entries);

	for (const exercise of microExercises) {
		const anchor = meso.anchor1rm[exercise];
		if (anchor == null) continue;

		const entry = entries
			.filter((item) => item.exercise === exercise && plan.dates.includes(item.date))
			.sort((a, b) => b.date.localeCompare(a.date))[0];

		const row = exerciseTargetOnMicro(cyclePlan, meso, plan, exercise, anchor, entry ?? undefined);
		if (row) intensityByExercise.push(row);
	}

	intensityByExercise.sort((a, b) => a.exercise.localeCompare(b.exercise, 'ru'));

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
	const microcycles = meso.microcycles
		.sort((a, b) => a.indexInMeso - b.indexInMeso)
		.map((micro, index) => ({ ...micro, indexInMeso: index + 1 }));
	const allDates = microcycles.flatMap((micro) => micro.dates).sort();
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
	entries: WorkoutEntry[]
): EnrichedMesocycle {
	const template = templateById(plan, meso.templateId);
	const normalized = reindexMeso(withComputedAnchors(meso, entries));
	const anchorInfo = buildAnchorInfo(normalized, entries);
	const effectiveMeso: MesocyclePlan = {
		...normalized,
		anchor1rm: Object.fromEntries(
			Object.entries(anchorInfo).map(([exercise, meta]) => [exercise, meta.anchor])
		)
	};
	const microcycles = normalized.microcycles.map((micro) =>
		enrichMicro(micro, effectiveMeso, plan, template, overview.byDate, entries)
	);
	const allMicroDates = normalized.microcycles.flatMap((m) => m.dates).sort();
	const startDate = allMicroDates[0] ?? normalized.startDate;
	const endDate = allMicroDates[allMicroDates.length - 1] ?? normalized.endDate;

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
			entries
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
	allDates: string[]
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

	const assigned = new Set(plan.mesocycles.flatMap((meso) => meso.microcycles.flatMap((m) => m.dates)));
	const unassignedDates = allDates.filter((date) => !assigned.has(date));

	const enrichedById = new Map(
		plan.mesocycles.map((meso, index) => [
			meso.id,
			enrichSingleMesocycle(meso, index + 1, plan, overview, entries)
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
			m.microcycles.flatMap((micro) => micro.plan.dates)
		);
		const startDate = macroDates.sort()[0] ?? macro.startDate;
		const endDate = macroDates.sort().slice(-1)[0] ?? macro.endDate;

		return {
			plan: { ...macro, startDate, endDate },
			index: macroIndex + 1,
			mesocycles,
			durationDays: startDate && endDate ? daysBetween(startDate, endDate) : 0
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
	return meso.microcycles.find((micro) => micro.plan.dates.includes(date)) ?? null;
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
			{ id: newId('micro'), indexInMeso: 1, dates: [] },
			{ id: newId('micro'), indexInMeso: 2, dates: [] }
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
				microcycles: [...meso.microcycles, { id: newId('micro'), indexInMeso: nextIndex, dates: [] }]
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

export function assignDate(
	plan: CyclePlan,
	mesoId: string,
	microId: string,
	date: string
): CyclePlan {
	const cleaned = unassignDate(plan, date);
	return touchPlan({
		...cleaned,
		mesocycles: cleaned.mesocycles.map((meso) => {
			if (meso.id !== mesoId) return meso;
			return reindexMeso({
				...meso,
				microcycles: meso.microcycles.map((micro) => {
					if (micro.id !== microId) return micro;
					const dates = [...new Set([...micro.dates, date])].sort();
					return { ...micro, dates };
				})
			});
		})
	});
}

export function unassignDate(plan: CyclePlan, date: string): CyclePlan {
	return touchPlan({
		...plan,
		mesocycles: plan.mesocycles.map((meso) =>
			reindexMeso({
				...meso,
				microcycles: meso.microcycles.map((micro) => ({
					...micro,
					dates: micro.dates.filter((item) => item !== date)
				}))
			})
		)
	});
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
	templateId: string | null
): CyclePlan {
	return touchPlan({
		...plan,
		mesocycles: plan.mesocycles.map((meso) => {
			if (meso.id !== mesoId) return meso;
			const exerciseProtocols = { ...(meso.exerciseProtocols ?? {}) };
			if (!templateId || templateId === meso.templateId) {
				delete exerciseProtocols[exercise];
			} else {
				exerciseProtocols[exercise] = templateId;
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
	endDate: string
): CyclePlan {
	return touchPlan({
		...plan,
		mesocycles: plan.mesocycles.map((meso) => {
			if (meso.id !== mesoId) return meso;
			const anchor1rm = { ...meso.anchor1rm };
			const anchor1rmManual = { ...(meso.anchor1rmManual ?? {}) };
			for (const exercise of pickMesoExercises(exerciseNames)) {
				if (anchor1rmManual[exercise]) continue;
				const resolved = resolveMesoAnchor1rm(entries, exercise, startDate, endDate);
				if (resolved) anchor1rm[exercise] = resolved.value;
			}
			return { ...meso, anchor1rm, anchor1rmManual };
		})
	});
}

/** Пересчитать якорные 1ПМ из данных; вручную заданные можно сохранить. */
export function refreshAllMesoAnchors(
	plan: CyclePlan,
	entries: WorkoutEntry[],
	keepManual = true
): CyclePlan {
	return touchPlan({
		...plan,
		mesocycles: plan.mesocycles.map((meso) => {
			const normalized = reindexMeso(meso);
			const anchor1rmManual = keepManual ? { ...(normalized.anchor1rmManual ?? {}) } : {};
			const exercises = mesoExercisesFromPlan(normalized, entries);
			const anchor1rm: Record<string, number> = {};

			for (const exercise of exercises) {
				if (keepManual && anchor1rmManual[exercise] && normalized.anchor1rm[exercise] != null) {
					anchor1rm[exercise] = normalized.anchor1rm[exercise];
					continue;
				}
				delete anchor1rmManual[exercise];
				const resolved = resolveMesoAnchor1rm(
					entries,
					exercise,
					normalized.startDate,
					normalized.endDate
				);
				if (resolved) anchor1rm[exercise] = resolved.value;
			}

			return { ...normalized, anchor1rm, anchor1rmManual };
		})
	});
}

export function markAnchorManual(
	plan: CyclePlan,
	mesoId: string,
	exercise: string,
	value: number
): CyclePlan {
	return touchPlan({
		...plan,
		mesocycles: plan.mesocycles.map((meso) => {
			if (meso.id !== mesoId) return meso;
			return {
				...meso,
				anchor1rm: { ...meso.anchor1rm, [exercise]: value },
				anchor1rmManual: { ...(meso.anchor1rmManual ?? {}), [exercise]: true }
			};
		})
	});
}

export function removeExerciseFromMeso(plan: CyclePlan, mesoId: string, exercise: string): CyclePlan {
	return touchPlan({
		...plan,
		mesocycles: plan.mesocycles.map((meso) => {
			if (meso.id !== mesoId) return meso;
			const anchor1rm = { ...meso.anchor1rm };
			delete anchor1rm[exercise];
			const exerciseProtocols = { ...(meso.exerciseProtocols ?? {}) };
			delete exerciseProtocols[exercise];
			return { ...meso, anchor1rm, exerciseProtocols };
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
	return { ...plan, updatedAt: new Date().toISOString() };
}

/** Fallback: auto mesocycles as read-only enriched view when no manual plan. */
export function autoMesocyclesAsView(
	overview: MicrocycleOverview,
	entries: WorkoutEntry[]
): EnrichedMesocycle[] {
	const templates = bundledProtocolTemplates();
	const cyclePlan: CyclePlan = {
		version: 1,
		updatedAt: '',
		templates: templates.map((item) => structuredClone(item)),
		macrocycles: [],
		mesocycles: []
	};
	const defaultTemplate = DEFAULT_PROTOCOL_TEMPLATE;

	return overview.mesocycles.map((meso, index) => {
		const exercises = mesoExerciseNames(overview, meso.index);
		const anchor1rm = buildAnchor1rm(exercises, entries, meso.startDate, meso.endDate);

		const plan: MesocyclePlan = {
			id: `auto-${meso.index}`,
			label: meso.label,
			startDate: meso.startDate,
			endDate: meso.endDate,
			templateId: defaultTemplate.id,
			anchor1rm,
			anchor1rmManual: {},
			exerciseProtocols: {},
			microcycles: meso.microcycles.map((micro) => ({
				id: `auto-micro-${micro.index}`,
				indexInMeso: micro.indexInMeso,
				dates: micro.days.map((day) => day.date)
			}))
		};

		const microcycles = plan.microcycles.map((microPlan) =>
			enrichMicro(microPlan, plan, cyclePlan, defaultTemplate, overview.byDate, entries)
		);
		const anchorInfo = buildAnchorInfo(plan, entries);

		return {
			plan,
			template: defaultTemplate,
			index: index + 1,
			anchorInfo,
			protocolMatrix: buildProtocolMatrix(plan, plan.microcycles, cyclePlan, anchorInfo, entries),
			microcycles,
			completeMicrocycles: meso.completeMicrocycles,
			durationDays: meso.durationDays,
			gapAfterDays: meso.gapAfterDays
		};
	});
}
