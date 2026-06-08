import { buildWorkoutData, mergeEntries } from './stats';
import { pendingToWorkoutEntries, type PendingEntry } from './pending';
import type { WorkoutData } from './types';

export function withPendingEntries(base: WorkoutData, pending: PendingEntry[]): WorkoutData {
	if (pending.length === 0) return base;

	const extraEntries = pendingToWorkoutEntries(pending);
	const entries = mergeEntries(base.entries, extraEntries);
	const { summary, trend } = buildWorkoutData(entries);

	return {
		...base,
		entries,
		summary,
		trend
	};
}

export function uniqueExercises(data: WorkoutData): string[] {
	return [...new Set(data.entries.map((entry) => entry.exercise))].sort((a, b) =>
		a.localeCompare(b, 'ru')
	);
}
