import { dateToMs } from './chart-time';
import {
	DEFAULT_PROTOCOL_TEMPLATE,
	type ProtocolPhase,
	type ProtocolTemplate,
	phaseForMicro,
	pickAnchorExercises,
	sessionIntensity,
	anchor1rmBeforeDate
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
	templateId: string;
	/** Якорные 1ПМ на старт мезо: упражнение → кг. */
	anchor1rm: Record<string, number>;
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

export type EnrichedMesocycle = {
	plan: MesocyclePlan;
	template: ProtocolTemplate;
	index: number;
	microcycles: EnrichedMicrocycle[];
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
		templates: [structuredClone(DEFAULT_PROTOCOL_TEMPLATE)],
		mesocycles: []
	};
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
		const exercises = new Set<string>();
		for (const micro of meso.microcycles) {
			for (const day of micro.days) {
				for (const exercise of day.exercises) exercises.add(exercise);
			}
		}
		const anchors = pickAnchorExercises([...exercises]);
		const anchor1rm: Record<string, number> = {};
		for (const exercise of anchors) {
			const value = anchor1rmBeforeDate(entries, exercise, meso.startDate);
			if (value) anchor1rm[exercise] = value;
		}

		return {
			id: newId('meso'),
			label: meso.label,
			startDate: meso.startDate,
			endDate: meso.endDate,
			templateId: defaultTemplateId,
			anchor1rm,
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
	template: ProtocolTemplate,
	byDate: Map<string, TrainingDay>,
	entries: WorkoutEntry[]
): EnrichedMicrocycle {
	const days = plan.dates
		.map((date) => dayFromOverview(byDate, date))
		.filter((day): day is TrainingDay => day !== null);
	const dayA = days.find((day) => day.slot === 'A') ?? null;
	const dayB = days.find((day) => day.slot === 'B') ?? null;
	const phase = phaseForMicro(template, plan.indexInMeso);
	const targetPct = plan.intensityPct ?? phase?.intensityPct ?? null;

	const anchorExercises = Object.keys(meso.anchor1rm);
	const intensityByExercise: ReturnType<typeof sessionIntensity>[] = [];
	if (targetPct !== null) {
		for (const exercise of anchorExercises) {
			const anchor = meso.anchor1rm[exercise];
			const entry = entries
				.filter((item) => item.exercise === exercise && plan.dates.includes(item.date))
				.sort((a, b) => b.date.localeCompare(a.date))[0];
			if (!entry) continue;
			const row = sessionIntensity(entry, anchor, targetPct);
			if (row) intensityByExercise.push(row);
		}
	}

	return {
		plan,
		dayA,
		dayB,
		complete: Boolean(dayA && dayB),
		phase,
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
		const normalized = reindexMeso(meso);
		const microcycles = normalized.microcycles.map((micro) =>
			enrichMicro(micro, normalized, template, overview.byDate, entries)
		);
		const allMicroDates = normalized.microcycles.flatMap((m) => m.dates).sort();
		const startDate = allMicroDates[0] ?? normalized.startDate;
		const endDate = allMicroDates[allMicroDates.length - 1] ?? normalized.endDate;

		return {
			plan: { ...normalized, startDate, endDate },
			template,
			index: index + 1,
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
	patch: Partial<Pick<MesocyclePlan, 'label' | 'templateId' | 'anchor1rm'>>
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
	const template = DEFAULT_PROTOCOL_TEMPLATE;
	return overview.mesocycles.map((meso, index) => {
		const exercises = new Set<string>();
		for (const micro of meso.microcycles) {
			for (const day of micro.days) {
				for (const exercise of day.exercises) exercises.add(exercise);
			}
		}
		const anchorExercises = pickAnchorExercises([...exercises]);
		const anchor1rm: Record<string, number> = {};
		for (const exercise of anchorExercises) {
			const value = anchor1rmBeforeDate(entries, exercise, meso.startDate);
			if (value) anchor1rm[exercise] = value;
		}

		const plan: MesocyclePlan = {
			id: `auto-${meso.index}`,
			label: meso.label,
			startDate: meso.startDate,
			endDate: meso.endDate,
			templateId: template.id,
			anchor1rm,
			microcycles: meso.microcycles.map((micro) => ({
				id: `auto-micro-${micro.index}`,
				indexInMeso: micro.indexInMeso,
				dates: micro.days.map((day) => day.date)
			}))
		};

		const microcycles = plan.microcycles.map((microPlan) =>
			enrichMicro(microPlan, plan, template, overview.byDate, entries)
		);

		return {
			plan,
			template,
			index: index + 1,
			microcycles,
			completeMicrocycles: meso.completeMicrocycles,
			durationDays: meso.durationDays,
			gapAfterDays: meso.gapAfterDays
		};
	});
}
