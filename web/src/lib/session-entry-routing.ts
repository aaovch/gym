import type { WorkoutEntry } from './types';

export type SessionEntryContext = {
	activeMicroSessionId: string | null;
	validMicroSessionIds: ReadonlySet<string>;
	workoutDate: string;
	slotExercises: readonly string[];
};

export type SessionRoutingRef = {
	id: string;
	mesoId: string;
	microId: string;
	slot: 'A' | 'B';
	date: string | null;
};

/**
 * Главная страница должна оставаться в последнем (текущем) мезоцикле.
 * Внутри него выбираем первую незакрытую тренировку, а когда все закрыты —
 * последнюю тренировку блока вместо возврата к старым незаполненным сессиям.
 */
export function preferredSessionInLatestMeso(
	sessions: readonly SessionRoutingRef[],
	isIncomplete: (session: SessionRoutingRef) => boolean
): SessionRoutingRef | null {
	const latestMesoId = sessions.at(-1)?.mesoId;
	if (!latestMesoId) return null;

	const currentSessions = sessions.filter((session) => session.mesoId === latestMesoId);
	return currentSessions.find(isIncomplete) ?? currentSessions.at(-1) ?? null;
}

function hasCurrentPlanLink(
	entry: WorkoutEntry,
	validMicroSessionIds: ReadonlySet<string>
): boolean {
	return Boolean(
		entry.microSessionId && validMicroSessionIds.has(entry.microSessionId)
	);
}

function belongsByLink(entry: WorkoutEntry, activeMicroSessionId: string | null): boolean {
	return Boolean(
		activeMicroSessionId && entry.microSessionId === activeMicroSessionId
	);
}

function belongsByLegacyDate(entry: WorkoutEntry, context: SessionEntryContext): boolean {
	return (
		entry.date === context.workoutDate &&
		!hasCurrentPlanLink(entry, context.validMicroSessionIds)
	);
}

/**
 * Плановые записи активной сессии.
 *
 * microSessionId имеет приоритет над календарной датой: запись, уже связанная
 * с другой существующей сессией, нельзя «перетянуть» в открытую тренировку
 * только потому, что даты совпали. Дата остаётся fallback для старых записей
 * без связи или с устаревшим id удалённой сессии.
 */
export function plannedEntriesForSession(
	entries: readonly WorkoutEntry[],
	context: SessionEntryContext
): WorkoutEntry[] {
	const plannedExercises = new Set(context.slotExercises);
	return entries.filter(
		(entry) =>
			plannedExercises.has(entry.exercise) &&
			(belongsByLink(entry, context.activeMicroSessionId) ||
				belongsByLegacyDate(entry, context))
	);
}

/** Записи активной сессии, упражнения которых отсутствуют в её плане. */
export function extraEntriesForSession(
	entries: readonly WorkoutEntry[],
	context: SessionEntryContext
): WorkoutEntry[] {
	const plannedExercises = new Set(context.slotExercises);
	return entries.filter(
		(entry) =>
			!plannedExercises.has(entry.exercise) &&
			(belongsByLink(entry, context.activeMicroSessionId) ||
				belongsByLegacyDate(entry, context))
	);
}

/**
 * При первом открытии оставляем пользователя в тренировке выбранной даты,
 * даже если она уже заполнена. Если на одну дату назначено несколько сессий,
 * побеждает сессия с фактическими связанными записями.
 */
export function preferredSessionForDate(
	sessions: readonly SessionRoutingRef[],
	entries: readonly WorkoutEntry[],
	date: string
): SessionRoutingRef | null {
	const linkedOnDate = new Map<string, number>();
	for (const entry of entries) {
		if (entry.date !== date || !entry.microSessionId) continue;
		linkedOnDate.set(entry.microSessionId, (linkedOnDate.get(entry.microSessionId) ?? 0) + 1);
	}

	let best: { session: SessionRoutingRef; linked: number; exactDate: boolean; order: number } | null = null;
	for (const [order, session] of sessions.entries()) {
		const linked = linkedOnDate.get(session.id) ?? 0;
		const exactDate = session.date === date;
		if (!exactDate && linked === 0) continue;

		if (
			!best ||
			linked > best.linked ||
			(linked === best.linked && exactDate && !best.exactDate) ||
			(linked === best.linked && exactDate === best.exactDate && order > best.order)
		) {
			best = { session, linked, exactDate, order };
		}
	}

	return best?.session ?? null;
}
