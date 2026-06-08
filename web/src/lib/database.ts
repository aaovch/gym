import type { RowInput, SessionRow, SetInput, WorkoutEntry, WorkoutSession } from './types';

export function formatWeight(value: number): string {
	if (Number.isInteger(value)) return String(value);
	return value.toFixed(1).replace('.', ',');
}

export function formatSet(weight: number, reps: number): string {
	return `${formatWeight(weight)}×${formatWeight(reps)}`;
}

export function formatSetsCell(sets: [number, number][], comment?: string | null): string {
	const body = sets.map(([weight, reps]) => formatSet(weight, reps)).join(', ');
	if (!comment?.trim()) return body;
	return `${body} (${comment.trim()})`;
}

export function parseSetInputs(inputs: SetInput[]): [number, number][] {
	return inputs
		.map(({ weight, reps }) => [Number(weight.replace(',', '.')), Number(reps.replace(',', '.'))] as const)
		.filter(([weight, reps]) => Number.isFinite(weight) && Number.isFinite(reps) && weight > 0 && reps > 0);
}

export function rowInputToSessionRow(row: RowInput): SessionRow | null {
	const sets = parseSetInputs(row.sets);
	if (sets.length === 0) return null;
	return {
		sets,
		comment: row.comment.trim() || null
	};
}

export function sessionToEntry(session: WorkoutSession): WorkoutEntry {
	const parts: string[] = [];
	const sets: [number, number][] = [];

	for (const row of session.rows) {
		if (row.sets.length === 0) continue;
		parts.push(formatSetsCell(row.sets, row.comment));
		sets.push(...row.sets);
	}

	return {
		id: session.id,
		exercise: session.exercise,
		date: session.date,
		parts,
		sets
	};
}

export function sessionsToEntries(sessions: WorkoutSession[]): WorkoutEntry[] {
	return sessions.map(sessionToEntry).filter((entry) => entry.sets.length > 0);
}

export function uniqueExercises(sessions: WorkoutSession[]): string[] {
	return [...new Set(sessions.map((session) => session.exercise))].sort((a, b) =>
		a.localeCompare(b, 'ru')
	);
}

export function emptySetInput(): SetInput {
	return { weight: '', reps: '' };
}

export function emptyRowInput(): RowInput {
	return { sets: [emptySetInput()], comment: '' };
}

export function createSession(
	exercise: string,
	date: string,
	rows: SessionRow[],
	id = crypto.randomUUID()
): WorkoutSession {
	return { id, exercise, date, rows };
}
