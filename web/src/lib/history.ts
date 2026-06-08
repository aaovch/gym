import { formatSetsCell } from './database';
import type { WorkoutSession } from './types';

function epley1rm(weight: number, reps: number): number {
	return weight * (1 + reps / 30);
}

export type SessionHistoryItem = {
	session: WorkoutSession;
	allSets: [number, number][];
	bestSet: [number, number];
	est1rm: number;
	tonnage: number;
};

export function sessionsForExercise(
	sessions: WorkoutSession[],
	exercise: string,
	newestFirst = true
): WorkoutSession[] {
	const filtered = sessions.filter((session) => session.exercise === exercise);
	return filtered.sort((a, b) =>
		newestFirst ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)
	);
}

export function buildSessionHistoryItem(session: WorkoutSession): SessionHistoryItem | null {
	const allSets = session.rows.flatMap((row) => row.sets);
	if (allSets.length === 0) return null;

	let bestSet = allSets[0];
	let est1rm = epley1rm(bestSet[0], bestSet[1]);
	let tonnage = 0;

	for (const [weight, reps] of allSets) {
		tonnage += weight * reps;
		const value = epley1rm(weight, reps);
		if (value > est1rm) {
			est1rm = value;
			bestSet = [weight, reps];
		}
	}

	return { session, allSets, bestSet, est1rm, tonnage };
}

export function exerciseHistory(
	sessions: WorkoutSession[],
	exercise: string,
	newestFirst = true
): SessionHistoryItem[] {
	return sessionsForExercise(sessions, exercise, newestFirst)
		.map(buildSessionHistoryItem)
		.filter((item): item is SessionHistoryItem => item !== null);
}

export function formatSessionRows(session: WorkoutSession): string[] {
	return session.rows
		.filter((row) => row.sets.length > 0)
		.map((row) => formatSetsCell(row.sets, row.comment));
}
