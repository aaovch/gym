import type { CyclePlan, MacrocyclePlan, MesocyclePlan } from './cycle-plan';
import type { WorkoutTemplate } from './microcycle';
import { mesocycleDisplayLabel } from './microcycle';
import { buildProtocolMatrix, type ExerciseAnchorInfo, type ProtocolMatrixRow } from './cycle-plan';
import { dateToMs } from './chart-time';
import { defaultMicroSessions } from './micro-plan';
import {
	buildExerciseSessionsRecord,
	buildMesocyclePlan,
	type MesoConstructorInput,
	type MesoExerciseSetup
} from './meso-constructor';
import { toExerciseId, type ExerciseKeyMaps } from './exercise-keys';
import { DEFAULT_PROTOCOL_TEMPLATE } from './protocol';

/** Средняя длительность одного микроцикла в календаре (дней). */
export const DAYS_PER_MICRO = 7;

export type MacroBlockInput = {
	label: string;
	microCount: number;
	defaultProtocolId?: string;
	exercises: MesoExerciseSetup[];
};

export type MacroConstructorInput = {
	label: string;
	startDate: string;
	blocks: MacroBlockInput[];
};

export type MacroBlockPreview = {
	label: string;
	startDate: string;
	endDate: string;
	microCount: number;
	protocolName: string;
	matrix: ProtocolMatrixRow[];
};

function addDays(iso: string, days: number): string {
	const d = new Date(dateToMs(iso) + days * 86400000);
	const y = d.getUTCFullYear();
	const m = String(d.getUTCMonth() + 1).padStart(2, '0');
	const day = String(d.getUTCDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

export function mesoCalendarEnd(startDate: string, microCount: number): string {
	if (microCount < 1) return startDate;
	return addDays(startDate, microCount * DAYS_PER_MICRO - 1);
}

export function nextMesoStartDate(previousStart: string, previousMicroCount: number): string {
	return addDays(mesoCalendarEnd(previousStart, previousMicroCount), 1);
}

export function defaultMacroStartDate(entries: { date: string }[]): string {
	if (entries.length === 0) return new Date().toISOString().slice(0, 10);
	const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
	return sorted[sorted.length - 1].date;
}

function blockAnchorInfo(exercises: MesoExerciseSetup[]): Record<string, ExerciseAnchorInfo> {
	const anchorInfo: Record<string, ExerciseAnchorInfo> = {};
	for (const row of exercises) {
		anchorInfo[row.exercise] = {
			anchor: row.anchor1rm,
			source: row.manual ? 'manual' : 'prior',
			anchorDate: null,
			current1rm: null,
			current1rmDate: null,
			manual: Boolean(row.manual)
		};
	}
	return anchorInfo;
}

export function previewMacroPlan(
	plan: CyclePlan,
	input: MacroConstructorInput,
	keyMaps: ExerciseKeyMaps,
	workoutTemplates: WorkoutTemplate[] = []
): MacroBlockPreview[] {
	if (input.blocks.length === 0) return [];

	let currentStart = input.startDate;
	const previews: MacroBlockPreview[] = [];
	let mesoNumber = plan.mesocycles.length;

	for (const block of input.blocks) {
		if (block.exercises.length === 0 || block.microCount < 1) {
			currentStart = nextMesoStartDate(currentStart, Math.max(1, block.microCount));
			continue;
		}

		mesoNumber += 1;
		const mesoLabel = mesocycleDisplayLabel(mesoNumber);
		const defaultProtocolId = block.defaultProtocolId ?? DEFAULT_PROTOCOL_TEMPLATE.id;
		const mesoPlan: MesocyclePlan = {
			id: 'preview-meso',
			label: mesoLabel,
			startDate: currentStart,
			endDate: mesoCalendarEnd(currentStart, block.microCount),
			templateId: defaultProtocolId,
			anchor1rm: Object.fromEntries(
				block.exercises.map((row) => [toExerciseId(row.exercise, keyMaps), row.anchor1rm])
			),
			exerciseProtocols: Object.fromEntries(
				block.exercises
					.filter((row) => row.protocolId !== defaultProtocolId)
					.map((row) => [toExerciseId(row.exercise, keyMaps), row.protocolId])
			),
			exerciseSessions: buildExerciseSessionsRecord(block.exercises, keyMaps),
			microcycles: Array.from({ length: block.microCount }, (_, index) => ({
				id: `preview-micro-${index + 1}`,
				indexInMeso: index + 1,
				sessions: defaultMicroSessions()
			}))
		};

		const template = plan.templates.find((item) => item.id === defaultProtocolId);
		previews.push({
			label: mesoLabel,
			startDate: currentStart,
			endDate: mesoPlan.endDate,
			microCount: block.microCount,
			protocolName: template?.name ?? defaultProtocolId,
			matrix: buildProtocolMatrix(
				mesoPlan,
				mesoPlan.microcycles,
				plan,
				blockAnchorInfo(block.exercises),
				[],
				keyMaps,
				{ workoutTemplates: mesoPlan.exerciseSessions ? [] : workoutTemplates }
			)
		});

		currentStart = nextMesoStartDate(currentStart, block.microCount);
	}

	return previews;
}

export function createMacrocycleFromConstructor(
	plan: CyclePlan,
	input: MacroConstructorInput,
	keyMaps: ExerciseKeyMaps
): CyclePlan {
	if (input.blocks.length === 0) return plan;

	const macroId = `macro-${crypto.randomUUID().slice(0, 8)}`;
	const mesoIds: string[] = [];
	const newMesos: MesocyclePlan[] = [];
	let currentStart = input.startDate;
	let mesoNumber = plan.mesocycles.length;

	for (const block of input.blocks) {
		if (block.exercises.length === 0 || block.microCount < 1) continue;

		mesoNumber += 1;
		const mesoInput: MesoConstructorInput = {
			label: mesocycleDisplayLabel(mesoNumber),
			startDate: currentStart,
			microCount: block.microCount,
			defaultProtocolId: block.defaultProtocolId,
			exercises: block.exercises
		};
		const meso = buildMesocyclePlan(mesoInput, keyMaps);
		mesoIds.push(meso.id);
		newMesos.push(meso);
		currentStart = nextMesoStartDate(currentStart, block.microCount);
	}

	if (mesoIds.length === 0) return plan;

	const macro: MacrocyclePlan = {
		id: macroId,
		label: input.label.trim() || 'Новый макроцикл',
		startDate: input.startDate,
		endDate: mesoCalendarEnd(
			newMesos[newMesos.length - 1].startDate,
			newMesos[newMesos.length - 1].microcycles.length
		),
		mesoIds
	};

	return {
		...plan,
		revision: plan.revision + 1,
		updatedAt: new Date().toISOString(),
		macrocycles: [...(plan.macrocycles ?? []), macro],
		mesocycles: [...plan.mesocycles, ...newMesos]
	};
}
