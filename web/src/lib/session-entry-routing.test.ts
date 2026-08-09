import assert from 'node:assert/strict';
import test from 'node:test';
import {
	extraEntriesForSession,
	plannedEntriesForSession,
	preferredSessionForDate,
	type SessionEntryContext
} from './session-entry-routing';
import type { WorkoutEntry } from './types';

function entry(
	id: string,
	exercise: string,
	microSessionId?: string,
	date = '2026-08-09'
): WorkoutEntry {
	return {
		id,
		exercise,
		kind: 'strength',
		date,
		parts: [],
		sets: [],
		...(microSessionId ? { microSessionId } : {})
	};
}

const context: SessionEntryContext = {
	activeMicroSessionId: 'session-a',
	validMicroSessionIds: new Set(['session-a', 'session-b']),
	workoutDate: '2026-08-09',
	slotExercises: ['shared', 'only-a']
};

test('same-date records linked to another session are not claimed by the active session', () => {
	const entries = [
		entry('a1', 'only-a', 'session-a'),
		entry('b1', 'shared', 'session-b'),
		entry('b2', 'only-b', 'session-b')
	];

	assert.deepEqual(
		plannedEntriesForSession(entries, context).map((item) => item.id),
		['a1']
	);
	assert.deepEqual(extraEntriesForSession(entries, context), []);
});

test('shared exercise from another session cannot complete active-session progress', () => {
	const entries = [
		entry('a1', 'only-a', 'session-a'),
		entry('b-shared', 'shared', 'session-b')
	];

	assert.equal(plannedEntriesForSession(entries, context).length, 1);
	assert.equal(context.slotExercises.length, 2);
});

test('an extra exercise linked to the active session stays in out-of-plan', () => {
	const entries = [entry('a-extra', 'only-b', 'session-a')];

	assert.deepEqual(
		extraEntriesForSession(entries, context).map((item) => item.id),
		['a-extra']
	);
});

test('date fallback supports records without a current plan link', () => {
	const entries = [
		entry('legacy-planned', 'only-a'),
		entry('legacy-extra', 'only-b', 'removed-session'),
		entry('other-date', 'only-a', undefined, '2026-08-08')
	];

	assert.deepEqual(
		plannedEntriesForSession(entries, context).map((item) => item.id),
		['legacy-planned']
	);
	assert.deepEqual(
		extraEntriesForSession(entries, context).map((item) => item.id),
		['legacy-extra']
	);
});

test('completed session with linked records remains preferred on its date', () => {
	const sessions = [
		{ id: 'session-a', mesoId: 'meso', microId: 'micro', slot: 'A' as const, date: '2026-08-09' },
		{ id: 'session-b', mesoId: 'meso', microId: 'micro', slot: 'B' as const, date: '2026-08-09' },
		{ id: 'next-session', mesoId: 'meso', microId: 'next', slot: 'A' as const, date: null }
	];
	const entries = [entry('b1', 'only-b', 'session-b'), entry('b2', 'shared', 'session-b')];

	assert.equal(preferredSessionForDate(sessions, entries, '2026-08-09')?.id, 'session-b');
});
