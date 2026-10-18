import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { aggregateExerciseEntries, primaryProgressEntries, recordedSetLocation } from './session-exercise-progress';
import { buildCyclePlanView, entriesForPlanSession, type CyclePlan } from './cycle-plan';
import { repairWorkoutLinks } from './data-repair';
import { logsToSessions, sessionsToEntries } from './database';
import { buildMicrocycleOverview } from './microcycle';
import { normalizeStoredCyclePlan, normalizeWorkoutDatabase, validateDatabasePlanLinks } from './json-store';
import { todayIso } from './format';
import type { ExerciseLog, WorkoutDatabase } from './types';

function log(id: string, date: string, session: string, weight: number, count: number, exerciseId = 'squat'): ExerciseLog {
	return { id, date, microSessionId: session, exerciseId, blocks: [{ kind: 'strength', sets: Array.from({ length: count }, () => [weight, 5]) }] };
}

function fixture(logs: ExerciseLog[] = []) {
	const db: WorkoutDatabase = { version: 4, revision: 0, updatedAt: '', exercises: [
		{ id: 'squat', name: 'Присед', kind: 'strength', movementBlocks: [] }
	], logs };
	const plan: CyclePlan = { version: 4, revision: 0, updatedAt: '', macrocycles: [], templates: [
		{ id: 'test', name: 'Тест', description: '', phases: [{ id: 'p1', label: '3×5', microFrom: 1, microTo: 1, intensityPct: 70 }] }
	], mesocycles: [{ id: 'meso', label: 'Мезо', startDate: '', endDate: '', templateId: 'test', anchor1rm: { squat: 100 }, anchor1rmManual: { squat: true },
		exerciseSessions: { squat: [0, 1] }, microcycles: [{ id: 'micro', indexInMeso: 1, sessions: [{ id: 'a', indexInMicro: 0 }, { id: 'b', indexInMicro: 1 }] }] }] };
	const entries = sessionsToEntries(logsToSessions(db));
	return { db, plan, entries, overview: buildMicrocycleOverview(logsToSessions(db)) };
}

test('one A/B collects dated records across visits, without borrowing same-date records from B', () => {
	const { plan, entries } = fixture([log('a1', '2026-10-19', 'a', 60, 2), log('a2', '2026-10-22', 'a', 65, 1), log('b1', '2026-10-22', 'b', 90, 3)]);
	const records = entriesForPlanSession(plan, plan.mesocycles[0].microcycles[0], 0, entries);
	assert.deepEqual(records.map((entry) => entry.id), ['a1', 'a2']);
	assert.equal(aggregateExerciseEntries(records).get('Присед')?.sets.length, 3);
});

test('combined progress keeps failed offsets and maps edits to their original dated log', () => {
	const first = log('first', '2026-10-19', 'a', 60, 2);
	first.blocks[0].comment = 'Первый день';
	first.blocks[0].failedSets = [1];
	first.blocks.push({ kind: 'strength', sets: [[20, 12]], comment: 'Дополнительно' });
	const second = log('second', '2026-10-22', 'a', 65, 1);
	second.blocks[0].failedSets = [0];
	const { db, entries } = fixture([second, first]);
	const before = structuredClone(db);
	const primary = primaryProgressEntries(entries, db.logs);
	const aggregate = aggregateExerciseEntries(primary).get('Присед')!;
	assert.equal(aggregate.id, undefined);
	assert.deepEqual(aggregate.sets, [[60, 5], [60, 5], [65, 5]]);
	assert.deepEqual(aggregate.failedSets, [1, 2]);
	const ordered = primary.map((entry) => db.logs.find((log) => log.id === entry.id)!);
	assert.deepEqual(recordedSetLocation(ordered, 2), { log: second, index: 0 });
	assert.equal(recordedSetLocation(ordered, 3), null);
	assert.deepEqual(db, before);
});

test('matrix, completion and date ranges follow facts for an undated plan', () => {
	const { db, plan, entries, overview } = fixture([log('a1', '2026-10-19', 'a', 75, 2), log('a2', '2026-10-22', 'a', 65, 1), log('b1', '2026-10-22', 'b', 90, 3)]);
	const before = structuredClone(plan);
	const view = buildCyclePlanView(plan, overview, entries, ['2026-10-19', '2026-10-22'], db.exercises);
	const meso = view.mesocycles[0];
	assert.equal(meso.microcycles[0].complete, true);
	assert.equal(meso.plan.startDate, '2026-10-19');
	assert.equal(meso.plan.endDate, '2026-10-22');
	assert.equal(meso.protocolMatrix[0].cells[0].factMaxWeight, 75);
	assert.equal(meso.protocolMatrix[0].cells[1].factMaxWeight, 90);
	assert.deepEqual(view.unassignedDates, []);
	assert.deepEqual(plan, before);
});

test('a partial visit does not complete a microcycle or advance a protocol phase', () => {
	const { db, plan, entries, overview } = fixture([log('a1', '2026-10-19', 'a', 60, 1), log('b1', '2026-10-22', 'b', 65, 3)]);
	const view = buildCyclePlanView(plan, overview, entries, [], db.exercises);
	assert.equal(view.mesocycles[0].microcycles[0].complete, false);
	assert.equal(view.mesocycles[0].microcycles[0].plan.indexInMeso, 1);
});

test('additional blocks are preserved but cannot prematurely complete the main assignment', () => {
	const first = log('a1', '2026-10-19', 'a', 60, 1);
	first.blocks.push({ kind: 'strength', sets: [[20, 12], [20, 12]] });
	const { db, plan, entries, overview } = fixture([first, log('b1', '2026-10-22', 'b', 65, 3)]);
	const view = buildCyclePlanView(plan, overview, entries, [], db.exercises);
	assert.deepEqual(view.mesocycles[0].microcycles[0].sessionComplete, [false, true]);
	assert.equal(db.logs[0].blocks.length, 2);
});

test('repair preserves explicit links even when their date matches another A/B slot', () => {
	const { db, plan, entries } = fixture([log('a1', '2026-10-22', 'a', 60, 3)]);
	plan.mesocycles[0].microcycles[0].sessions[1].date = '2026-10-22';
	const before = structuredClone({ db, plan });
	const repaired = repairWorkoutLinks(db, plan, entries);
	assert.deepEqual(repaired.database, before.db);
	assert.deepEqual(repaired.plan, before.plan);
	assert.equal(repaired.logsLinked, 0);
	validateDatabasePlanLinks(repaired.database, repaired.plan);
});

test('repair preserves historical content and all valid links in canonical data; only stale IDs can change', () => {
	const db = normalizeWorkoutDatabase(JSON.parse(readFileSync(new URL('../../../data/workouts.json', import.meta.url), 'utf8')));
	const plan = normalizeStoredCyclePlan(JSON.parse(readFileSync(new URL('../../../data/cycle-plan.json', import.meta.url), 'utf8')));
	const entries = sessionsToEntries(logsToSessions(db));
	const before = structuredClone({ db, plan });
	const repaired = repairWorkoutLinks(db, plan, entries);
	const validIds = new Set(plan!.mesocycles.flatMap((meso) => meso.microcycles.flatMap((micro) => micro.sessions.map((session) => session.id))));
	assert.equal(repaired.database.logs.length, before.db.logs.length);
	for (const [index, previous] of before.db.logs.entries()) {
		const current = repaired.database.logs[index];
		const { microSessionId: oldLink, ...oldContent } = previous;
		const { microSessionId: newLink, ...newContent } = current;
		assert.deepEqual(newContent, oldContent, `historical log ${previous.id}`);
		if (oldLink && validIds.has(oldLink)) assert.equal(newLink, oldLink, previous.id);
	}
	assert.deepEqual(repaired.plan, before.plan);
	validateDatabasePlanLinks(repaired.database, repaired.plan);
});

test('today uses the local calendar at midnight rather than UTC', () => {
	assert.equal(todayIso(new Date(2026, 9, 18, 0, 15)), '2026-10-18');
	assert.equal(todayIso(new Date(2026, 9, 18, 23, 55)), '2026-10-18');
});
