import type { ExerciseLog, WorkoutEntry } from './types';

/** Порядок одинаков для отображения подходов и изменения их исходных записей. */
export function orderedExerciseEntries(entries: readonly WorkoutEntry[]): WorkoutEntry[] {
	return [...entries].sort((a, b) => a.date.localeCompare(b.date) || (a.id ?? '').localeCompare(b.id ?? ''));
}

/** Прогресс задания считается по основному блоку; дополнительные блоки сохраняются отдельно. */
export function primaryProgressEntries(entries: readonly WorkoutEntry[], logs: readonly ExerciseLog[]): WorkoutEntry[] {
	const byId = new Map(logs.map((log) => [log.id, log]));
	return orderedExerciseEntries(entries).map((entry) => {
		const row = entry.id ? byId.get(entry.id)?.blocks[0] : undefined;
		return row ? { ...entry, sets: row.sets, failedSets: row.failedSets ?? [] } : entry;
	});
}

/** Только проекция: исходные логи, даты, комментарии и id не объединяются. */
export function aggregateExerciseEntries(entries: readonly WorkoutEntry[]): Map<string, WorkoutEntry> {
	const result = new Map<string, WorkoutEntry>();
	for (const entry of orderedExerciseEntries(entries)) {
		const previous = result.get(entry.exercise);
		if (!previous) {
			result.set(entry.exercise, { ...entry, sets: [...entry.sets], parts: [...entry.parts], failedSets: [...(entry.failedSets ?? [])] });
			continue;
		}
		result.set(entry.exercise, {
			...entry,
			id: undefined,
			sets: [...previous.sets, ...entry.sets],
			primarySetCount: (previous.primarySetCount ?? previous.sets.length) + (entry.primarySetCount ?? entry.sets.length),
			parts: [...previous.parts, ...entry.parts],
			failedSets: [...(previous.failedSets ?? []), ...(entry.failedSets ?? []).map((index) => previous.sets.length + index)]
		});
	}
	return result;
}

export function recordedSetLocation(logs: readonly ExerciseLog[], setIndex: number): { log: ExerciseLog; index: number } | null {
	if (setIndex < 0) return null;
	for (const log of logs) {
		const count = log.blocks[0]?.sets.length ?? 0;
		if (setIndex < count) return { log, index: setIndex };
		setIndex -= count;
	}
	return null;
}
