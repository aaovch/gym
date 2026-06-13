import { targetPctForExercise, type CyclePlan, type MesocyclePlan, type MicrocyclePlan } from './cycle-plan';
import { formatSet, formatWeight } from './database';
import { mesoProtocolId, type ExerciseKeyMaps } from './exercise-keys';
import { schemeToSets, targetWeight } from './protocol';
import type { ProtocolGuideWeek, VolumeGuideRow } from './training-theses';
import { volumeGuideRowForPct } from './volume-guide';
import type { ExerciseKind, ExerciseSet, RowInput, WorkoutEntry } from './types';

const PRESCRIPTION_RE = /(\d+)\s*(?:[–-]\s*\d+)?\s*[x×]\s*(\d+)/i;

export function parsePrescription(prescription: string, weightKg: number): ExerciseSet[] | null {
	const trimmed = prescription.trim();
	if (!trimmed || trimmed === '—' || trimmed === '-') return null;
	const match = trimmed.match(PRESCRIPTION_RE);
	if (!match) return null;
	const setCount = Number(match[1]);
	const reps = Number(match[2]);
	if (!Number.isFinite(setCount) || !Number.isFinite(reps) || setCount <= 0 || reps <= 0) return null;
	return Array.from({ length: setCount }, () => [weightKg, reps] as ExerciseSet);
}

export function lastEntryBefore(
	entries: WorkoutEntry[],
	exercise: string,
	beforeDate: string
): WorkoutEntry | null {
	let best: WorkoutEntry | null = null;
	for (const entry of entries) {
		if (entry.exercise !== exercise || entry.date >= beforeDate) continue;
		if (!best || entry.date > best.date) best = entry;
	}
	return best;
}

export function protocolGuideWeek(
	weeks: ProtocolGuideWeek[] | undefined,
	microIndex: number
): ProtocolGuideWeek | null {
	if (!weeks?.length) return null;
	const index = Math.min(Math.max(microIndex, 1), weeks.length) - 1;
	return weeks[index] ?? null;
}

export type PlannedSetsInput = {
	exercise: string;
	kind: ExerciseKind;
	date: string;
	entries: WorkoutEntry[];
	anchor1rm: number | null;
	cyclePlan: CyclePlan;
	meso: MesocyclePlan;
	micro: MicrocyclePlan;
	keyMaps: ExerciseKeyMaps;
	protocolGuideWeek?: ProtocolGuideWeek | null;
	volumeGuideRows: VolumeGuideRow[];
	/** false для нового μ без назначенной даты — не копировать прошлую тренировку. */
	allowLastWorkoutFallback?: boolean;
};

export function suggestPlannedSets(input: PlannedSetsInput): ExerciseSet[] {
	const { pct, phase } = targetPctForExercise(
		input.cyclePlan,
		input.meso,
		input.micro,
		input.exercise,
		input.keyMaps
	);

	if (pct != null && pct <= 0) return [];

	if (input.anchor1rm && phase?.scheme?.length) {
		const scheme = schemeToSets(phase.scheme, input.anchor1rm);
		if (scheme.length) return scheme;
	}

	const plannedWeight =
		input.anchor1rm && pct ? targetWeight(input.anchor1rm, pct) : null;

	if (plannedWeight && input.protocolGuideWeek?.prescription) {
		const parsed = parsePrescription(input.protocolGuideWeek.prescription, plannedWeight);
		if (parsed?.length) return parsed;
	}

	if (plannedWeight && pct) {
		const row = volumeGuideRowForPct(input.volumeGuideRows, pct);
		if (row) {
			const repsMatch = row.repsPerSet.match(/(\d+)(?:\s*[–-]\s*(\d+))?/);
			const reps = repsMatch
				? Math.round((Number(repsMatch[1]) + Number(repsMatch[2] ?? repsMatch[1])) / 2)
				: 5;
			const setCount = Math.max(1, Math.round(row.optimalTotalReps / reps));
			return Array.from({ length: setCount }, () => [plannedWeight, reps] as ExerciseSet);
		}
	}

	if (input.allowLastWorkoutFallback !== false) {
		const last = lastEntryBefore(input.entries, input.exercise, input.date);
		if (last?.sets.length) {
			if (input.kind !== 'strength') return last.sets.map((set) => [...set] as ExerciseSet);
			const weight = plannedWeight ?? last.sets[0]![0];
			return last.sets.map(([, reps]) => [weight, reps] as ExerciseSet);
		}
	}

	if (plannedWeight) return [[plannedWeight, 5]];
	return [[100, 5]];
}

export function setsToRowInput(sets: ExerciseSet[]): RowInput {
	return {
		sets: sets.map(([weight, reps]) => ({
			weight: formatWeight(weight),
			reps: formatWeight(reps)
		})),
		comment: ''
	};
}

export function formatPlannedSets(sets: ExerciseSet[], kind: ExerciseKind): string {
	if (!sets.length) return '';
	return sets
		.map((set) => {
			const [first, second] = set;
			if (kind === 'run') return `${first} мин · ${second} км/ч`;
			if (kind === 'jumps') return `${first}×${second}`;
			return formatSet(first, second);
		})
		.join(', ');
}
