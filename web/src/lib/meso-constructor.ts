import type { CyclePlan, MesocyclePlan, MicrocyclePlan, ProtocolMatrixRow } from './cycle-plan';
import {
	buildProtocolMatrix,
	type ExerciseAnchorInfo
} from './cycle-plan';
import { toExerciseId, type ExerciseKeyMaps } from './exercise-keys';
import { defaultMicroSessions } from './micro-plan';
import type { WorkoutTemplate } from './microcycle';
import {
	DEFAULT_PROTOCOL_TEMPLATE,
	pickMesoExercises,
	resolveMesoAnchor1rm,
	targetWeight,
	type ProtocolTemplate
} from './protocol';
import type { WorkoutEntry } from './types';

export type MesoExerciseSetup = {
	exercise: string;
	protocolId: string;
	anchor1rm: number;
	manual?: boolean;
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
	workoutTemplates: WorkoutTemplate[]
): string[] {
	const names = new Set<string>();
	for (const entry of entries) names.add(entry.exercise);
	for (const template of workoutTemplates) {
		for (const exercise of template.exercises) names.add(exercise);
	}
	return pickMesoExercises([...names]);
}

export function defaultMesoStartDate(entries: WorkoutEntry[]): string {
	if (entries.length === 0) return new Date().toISOString().slice(0, 10);
	const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
	return sorted[sorted.length - 1].date;
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
		microcycles: microPlans
	};

	return { mesoPlan, microPlans, anchorInfo };
}

export function previewMesoPlan(
	plan: CyclePlan,
	input: MesoConstructorInput,
	keyMaps: ExerciseKeyMaps
): ProtocolMatrixRow[] {
	if (input.exercises.length === 0 || input.microCount < 1) return [];
	const { mesoPlan, microPlans, anchorInfo } = buildPreviewMesoPlan(plan, input, keyMaps);
	return buildProtocolMatrix(mesoPlan, microPlans, plan, anchorInfo, [], keyMaps);
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

export function buildMesocyclePlan(input: MesoConstructorInput, keyMaps: ExerciseKeyMaps): MesocyclePlan {
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
		id: `meso-${crypto.randomUUID().slice(0, 8)}`,
		label: input.label.trim() || 'Новый блок',
		startDate: input.startDate,
		endDate: '',
		templateId: defaultProtocolId,
		anchor1rm,
		anchor1rmManual,
		exerciseProtocols,
		microcycles: Array.from({ length: input.microCount }, (_, index) => ({
			id: `micro-${crypto.randomUUID().slice(0, 8)}`,
			indexInMeso: index + 1,
			sessions: defaultMicroSessions()
		}))
	};
}

export { targetWeight };
