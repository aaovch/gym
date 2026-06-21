import type { CyclePlan, MesocyclePlan, MicrocyclePlan, ProtocolMatrixRow } from './cycle-plan';
import {
	buildProtocolMatrix,
	type ExerciseAnchorInfo
} from './cycle-plan';
import { toExerciseId, type ExerciseKeyMaps } from './exercise-keys';
import { defaultMicroSessions, microDates } from './micro-plan';
import type { WorkoutTemplate } from './microcycle';
import {
	best1rmAllTime,
	DEFAULT_PROTOCOL_TEMPLATE,
	pickMesoExercises,
	resolveMesoAnchor1rm,
	targetWeight,
	type ProtocolTemplate
} from './protocol';
import type { Exercise, WorkoutEntry } from './types';

export type MesoExerciseSetup = {
	exercise: string;
	protocolId: string;
	anchor1rm: number;
	manual?: boolean;
	/** 0 = тренировка A, 1 = тренировка B. Минимум один день. */
	sessions: (0 | 1)[];
};

export type MesoConstructorInput = {
	label: string;
	startDate: string;
	microCount: number;
	defaultProtocolId?: string;
	exercises: MesoExerciseSetup[];
	/** Макроцикл, в чей упорядоченный список mesoIds будет добавлен новый блок. */
	macroId?: string;
};

export type MesoConstructorExerciseRow = {
	exercise: string;
	enabled: boolean;
	protocolId: string;
	anchor1rm: number;
	manual: boolean;
	anchorSource: string;
};

export function knownMesoExercises(
	entries: WorkoutEntry[],
	workoutTemplates: WorkoutTemplate[],
	catalog: Exercise[] = []
): string[] {
	const names = new Set<string>();
	for (const entry of entries) names.add(entry.exercise);
	for (const template of workoutTemplates) {
		for (const exercise of template.exercises) names.add(exercise);
	}
	for (const exercise of catalog) {
		if (exercise.kind === 'strength') names.add(exercise.name);
	}
	return pickMesoExercises([...names]);
}

export function mergeConstructorExerciseNames(
	known: string[],
	selection: Map<string, unknown>
): string[] {
	const names = new Set(known);
	for (const exercise of selection.keys()) names.add(exercise);
	return pickMesoExercises([...names]);
}

export function defaultMesoStartDate(entries: WorkoutEntry[]): string {
	if (entries.length === 0) return new Date().toISOString().slice(0, 10);
	const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
	return sorted[sorted.length - 1].date;
}

export function defaultExerciseSessions(
	exercise: string,
	workoutTemplates: WorkoutTemplate[]
): { sessionA: boolean; sessionB: boolean } {
	if (workoutTemplates.length === 0) return { sessionA: true, sessionB: false };
	const templateA = workoutTemplates.find((item) => item.indexInMicro === 0);
	const templateB = workoutTemplates.find((item) => item.indexInMicro === 1);
	const inA = !templateA?.exercises.length || templateA.exercises.includes(exercise);
	const inB = !templateB?.exercises.length || templateB.exercises.includes(exercise);
	if (!inA && !inB) return { sessionA: true, sessionB: false };
	return { sessionA: inA, sessionB: inB };
}

export function sessionsFromFlags(sessionA: boolean, sessionB: boolean): (0 | 1)[] {
	const sessions: (0 | 1)[] = [];
	if (sessionA) sessions.push(0);
	if (sessionB) sessions.push(1);
	return sessions.length ? sessions : [0];
}

export function buildExerciseSessionsRecord(
	exercises: MesoExerciseSetup[],
	keyMaps: ExerciseKeyMaps
): Record<string, (0 | 1)[]> {
	const record: Record<string, (0 | 1)[]> = {};
	for (const row of exercises) {
		const sessions: (0 | 1)[] = row.sessions.length ? row.sessions : [0];
		record[toExerciseId(row.exercise, keyMaps)] = sessions;
	}
	return record;
}

export function resolveExerciseAnchor(
	entries: WorkoutEntry[],
	exercise: string,
	startDate: string
): { value: number | null; source: string } {
	const anchor = resolveMesoAnchor1rm(entries, exercise, startDate, startDate);
	if (anchor) {
		const source =
			anchor.source === 'prior'
				? 'до старта мезо'
				: anchor.source === 'in_meso'
					? 'из истории'
					: 'расчёт';
		return { value: anchor.value, source };
	}
	const allTime = best1rmAllTime(entries, exercise);
	if (allTime) {
		return { value: allTime.value, source: 'лучший результат' };
	}
	return { value: null, source: 'нет данных' };
}

function buildPreviewMesoPlan(
	plan: CyclePlan,
	input: MesoConstructorInput,
	keyMaps: ExerciseKeyMaps
): { mesoPlan: MesocyclePlan; microPlans: MicrocyclePlan[]; anchorInfo: Record<string, ExerciseAnchorInfo> } {
	const defaultProtocolId = input.defaultProtocolId ?? plan.templates[0]?.id ?? DEFAULT_PROTOCOL_TEMPLATE.id;
	const exerciseProtocols: Record<string, string> = {};
	const anchor1rm: Record<string, number> = {};
	const anchor1rmManual: Record<string, boolean> = {};
	const anchorInfo: Record<string, ExerciseAnchorInfo> = {};

	for (const row of input.exercises) {
		const id = toExerciseId(row.exercise, keyMaps);
		anchor1rm[id] = row.anchor1rm;
		if (row.manual) anchor1rmManual[id] = true;
		if (row.protocolId !== defaultProtocolId) exerciseProtocols[id] = row.protocolId;
		anchorInfo[row.exercise] = {
			anchor: row.anchor1rm,
			source: row.manual ? 'manual' : 'prior',
			anchorDate: null,
			current1rm: null,
			current1rmDate: null,
			manual: Boolean(row.manual)
		};
	}

	const microPlans: MicrocyclePlan[] = Array.from({ length: input.microCount }, (_, index) => ({
		id: `preview-micro-${index + 1}`,
		indexInMeso: index + 1,
		sessions: defaultMicroSessions()
	}));

	const mesoPlan: MesocyclePlan = {
		id: 'preview-meso',
		label: input.label,
		startDate: input.startDate,
		endDate: input.startDate,
		templateId: defaultProtocolId,
		anchor1rm,
		anchor1rmManual,
		exerciseProtocols,
		exerciseSessions: buildExerciseSessionsRecord(input.exercises, keyMaps),
		microcycles: microPlans
	};

	return { mesoPlan, microPlans, anchorInfo };
}

export function previewMesoPlan(
	plan: CyclePlan,
	input: MesoConstructorInput,
	keyMaps: ExerciseKeyMaps,
	workoutTemplates: WorkoutTemplate[] = []
): ProtocolMatrixRow[] {
	if (input.exercises.length === 0 || input.microCount < 1) return [];
	const { mesoPlan, microPlans, anchorInfo } = buildPreviewMesoPlan(plan, input, keyMaps);
	return buildProtocolMatrix(mesoPlan, microPlans, plan, anchorInfo, [], keyMaps, {
		workoutTemplates: mesoPlan.exerciseSessions ? [] : workoutTemplates
	});
}

export function suggestedMicroCount(templates: ProtocolTemplate[], exercises: MesoExerciseSetup[]): number {
	let maxPhase = 4;
	for (const row of exercises) {
		const template = templates.find((item) => item.id === row.protocolId);
		if (!template) continue;
		for (const phase of template.phases) {
			maxPhase = Math.max(maxPhase, phase.microTo);
		}
	}
	return Math.min(12, Math.max(1, maxPhase));
}

function clampMicroCount(count: number): number {
	return Math.max(1, Math.min(12, Math.floor(count) || 1));
}

function mesocycleExerciseFieldsFromInput(
	input: MesoConstructorInput,
	keyMaps: ExerciseKeyMaps
): Pick<
	MesocyclePlan,
	'templateId' | 'anchor1rm' | 'anchor1rmManual' | 'exerciseProtocols' | 'exerciseSessions'
> {
	const defaultProtocolId = input.defaultProtocolId ?? DEFAULT_PROTOCOL_TEMPLATE.id;
	const exerciseProtocols: Record<string, string> = {};
	const anchor1rm: Record<string, number> = {};
	const anchor1rmManual: Record<string, boolean> = {};

	for (const row of input.exercises) {
		const id = toExerciseId(row.exercise, keyMaps);
		anchor1rm[id] = row.anchor1rm;
		if (row.manual) anchor1rmManual[id] = true;
		if (row.protocolId !== defaultProtocolId) exerciseProtocols[id] = row.protocolId;
	}

	return {
		templateId: defaultProtocolId,
		anchor1rm,
		anchor1rmManual,
		exerciseProtocols,
		exerciseSessions: buildExerciseSessionsRecord(input.exercises, keyMaps)
	};
}

function newMicrocyclePlan(indexInMeso: number): MicrocyclePlan {
	return {
		id: `micro-${crypto.randomUUID().slice(0, 8)}`,
		indexInMeso,
		sessions: defaultMicroSessions()
	};
}

function mergeMicrocycles(existing: MicrocyclePlan[], targetCount: number): MicrocyclePlan[] {
	const sorted = [...existing].sort((a, b) => a.indexInMeso - b.indexInMeso);
	if (targetCount > sorted.length) {
		return [
			...sorted,
			...Array.from({ length: targetCount - sorted.length }, (_, index) =>
				newMicrocyclePlan(sorted.length + index + 1)
			)
		];
	}
	return sorted.slice(0, targetCount);
}

function reindexMesoPlan(meso: MesocyclePlan): MesocyclePlan {
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

export function createMesocycleFromConstructor(
	plan: CyclePlan,
	input: MesoConstructorInput,
	keyMaps: ExerciseKeyMaps
): CyclePlan {
	const meso = buildMesocyclePlan(input, keyMaps);
	const macroId = input.macroId;

	if (!macroId) {
		return {
			...plan,
			revision: plan.revision + 1,
			updatedAt: new Date().toISOString(),
			mesocycles: [...plan.mesocycles, meso]
		};
	}

	return {
		...plan,
		revision: plan.revision + 1,
		updatedAt: new Date().toISOString(),
		macrocycles: (plan.macrocycles ?? []).map((macro) =>
			macro.id === macroId ? { ...macro, mesoIds: [...macro.mesoIds, meso.id] } : macro
		),
		mesocycles: [...plan.mesocycles, meso]
	};
}

export function patchMesocycleFromConstructor(
	existing: MesocyclePlan,
	input: MesoConstructorInput,
	keyMaps: ExerciseKeyMaps
): MesocyclePlan {
	const fields = mesocycleExerciseFieldsFromInput(input, keyMaps);
	const targetCount = clampMicroCount(input.microCount);

	return reindexMesoPlan({
		...existing,
		label: input.label.trim() || existing.label,
		startDate: input.startDate || existing.startDate,
		...fields,
		microcycles: mergeMicrocycles(existing.microcycles, targetCount)
	});
}

export function updateMesocycleFromConstructor(
	plan: CyclePlan,
	mesoId: string,
	input: MesoConstructorInput,
	keyMaps: ExerciseKeyMaps
): CyclePlan {
	return {
		...plan,
		revision: plan.revision + 1,
		updatedAt: new Date().toISOString(),
		mesocycles: plan.mesocycles.map((meso) =>
			meso.id === mesoId ? patchMesocycleFromConstructor(meso, input, keyMaps) : meso
		)
	};
}

export function buildMesocyclePlan(input: MesoConstructorInput, keyMaps: ExerciseKeyMaps): MesocyclePlan {
	const fields = mesocycleExerciseFieldsFromInput(input, keyMaps);
	const targetCount = clampMicroCount(input.microCount);

	return {
		id: `meso-${crypto.randomUUID().slice(0, 8)}`,
		label: input.label.trim() || 'Новый блок',
		startDate: input.startDate,
		endDate: '',
		...fields,
		microcycles: Array.from({ length: targetCount }, (_, index) => newMicrocyclePlan(index + 1))
	};
}

export { targetWeight };
