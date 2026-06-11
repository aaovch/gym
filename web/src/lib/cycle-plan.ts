import { dateToMs } from './chart-time';
import {
	DEFAULT_PROTOCOL_TEMPLATE,
	STABLE_PROTOCOL_TEMPLATE,
	type MesoAnchor1rm,
	type ProtocolPhase,
	type ProtocolTemplate,
	best1rmInRange,
	phaseForMicro,
	pickMesoExercises,
	plannedSessionIntensity,
	resolveMesoAnchor1rm,
	sessionIntensity
} from './protocol';
import type { MicrocycleOverview, TrainingDay } from './microcycle';
import type { WorkoutEntry } from './types';

export type { ProtocolPhase, ProtocolTemplate };
export { DEFAULT_PROTOCOL_TEMPLATE, phaseForMicro, targetWeight } from './protocol';

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
	/** Протокол по умолчанию для упражнений без своего шаблона. */
	templateId: string;
	/** Якорные 1ПМ на старт мезо: упражнение → кг. */
	anchor1rm: Record<string, number>;
	/** Упражнения с вручную заданным якорем — не пересчитываются автоматически. */
	anchor1rmManual?: Record<string, boolean>;
	/** Свой протокол для упражнения (id шаблона). Пусто → templateId мезо. */
	exerciseProtocols?: Record<string, string>;
};

export type CyclePlan = {
	version: 1;
	updatedAt: string;
	templates: ProtocolTemplate[];
	mesocycles: MesocyclePlan[];
};

export type EnrichedMicrocycle = {
	plan: MicrocyclePlan;
	dayA: TrainingDay | null;
	dayB: TrainingDay | null;
	complete: boolean;
	phase: ProtocolPhase | null;
	targetPct: number | null;
	intensityByExercise: ReturnType<typeof sessionIntensity>[];
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
	completeMicrocycles: number;
	durationDays: number;
	gapAfterDays: number | null;
};

export type CyclePlanView = {
	plan: CyclePlan | null;
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
		templates: [
			structuredClone(DEFAULT_PROTOCOL_TEMPLATE),
			structuredClone(STABLE_PROTOCOL_TEMPLATE)
		],
		mesocycles: []
	};
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
	const pct = micro.intensityPct ?? phase?.intensityPct ?? null;
	return { pct, phase, template };
}

export function importPlanFromAuto(
	overview: MicrocycleOverview,
	entries: WorkoutEntry[],
	existing?: CyclePlan | null
): CyclePlan {
	const templates = existing?.templates?.length
		? existing.templates
		: [structuredClone(DEFAULT_PROTOCOL_TEMPLATE)];
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
	for (const exercise of Object.keys(meso.anchor1rm)) {
		const anchor = meso.anchor1rm[exercise];
		const { pct, phase, template } = targetPctForExercise(cyclePlan, meso, plan, exercise);
		if (pct === null) continue;

		const entry = entries
			.filter((item) => item.exercise === exercise && plan.dates.includes(item.date))
			.sort((a, b) => b.date.localeCompare(a.date))[0];

		if (entry) {
			const row = sessionIntensity(entry, anchor, pct);
			if (row) {
				row.protocolLabel = template.name;
				if (phase && phase.label !== defaultPhase?.label) row.protocolLabel += ` · ${phase.label}`;
				intensityByExercise.push(row);
			}
		} else {
			intensityByExercise.push(
				plannedSessionIntensity(exercise, anchor, pct, template.name)
			);
		}
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

export function buildCyclePlanView(
	plan: CyclePlan | null,
	overview: MicrocycleOverview,
	entries: WorkoutEntry[],
	allDates: string[]
): CyclePlanView {
	if (!plan || plan.mesocycles.length === 0) {
		return {
			plan,
			mesocycles: [],
			unassignedDates: allDates,
			usingManualPlan: false
		};
	}

	const assigned = new Set(plan.mesocycles.flatMap((meso) => meso.microcycles.flatMap((m) => m.dates)));
	const unassignedDates = allDates.filter((date) => !assigned.has(date));

	const mesocycles: EnrichedMesocycle[] = plan.mesocycles.map((meso, index) => {
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
			index: index + 1,
			anchorInfo,
			microcycles,
			completeMicrocycles: microcycles.filter((m) => m.complete).length,
			durationDays: startDate && endDate ? daysBetween(startDate, endDate) : 0,
			gapAfterDays: null
		};
	});

	for (let i = 0; i < mesocycles.length - 1; i++) {
		mesocycles[i].gapAfterDays = daysBetween(
			mesocycles[i].plan.endDate,
			mesocycles[i + 1].plan.startDate
		);
	}

	return {
		plan,
		mesocycles,
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

export function removeMesocycle(plan: CyclePlan, mesoId: string): CyclePlan {
	return touchPlan({
		...plan,
		mesocycles: plan.mesocycles.filter((meso) => meso.id !== mesoId)
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
	const templates = [DEFAULT_PROTOCOL_TEMPLATE, STABLE_PROTOCOL_TEMPLATE];
	const cyclePlan: CyclePlan = {
		version: 1,
		updatedAt: '',
		templates: templates.map((item) => structuredClone(item)),
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
			microcycles,
			completeMicrocycles: meso.completeMicrocycles,
			durationDays: meso.durationDays,
			gapAfterDays: meso.gapAfterDays
		};
	});
}
