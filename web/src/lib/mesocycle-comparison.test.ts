import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProtocolMatrixCell, ProtocolMatrixRow } from './cycle-plan';
import { cellComparisonKey, compareExercisePlan } from './mesocycle-comparison';

function cell(
	microIndex: number,
	sessionIndex: 0 | 1,
	targetWeight: number,
	pct = 70,
	applicable = true
): ProtocolMatrixCell {
	return {
		microIndex,
		sessionIndex,
		date: null,
		applicable,
		pct,
		label: null,
		targetWeight,
		factMaxPct: null,
		factMaxWeight: null,
		plannedOnly: true
	};
}

function row(anchor: number, templateName: string, cells: ProtocolMatrixCell[]): ProtocolMatrixRow {
	return { exercise: 'Тяга', anchor, templateName, cells };
}

test('compares anchor and planned targets with the same exercise in the previous mesocycle', () => {
	const previous = row(110, 'Субмаксимальный', [cell(1, 0, 77, 70)]);
	const current = row(115, 'Субмаксимальный', [cell(1, 0, 80.5, 70)]);
	const comparison = compareExercisePlan(current, previous);

	assert.equal(comparison?.anchorDelta, 5);
	assert.ok(Math.abs((comparison?.anchorPctDelta ?? 0) - 4.545) < 0.01);
	assert.equal(comparison?.cells[cellComparisonKey(1, 0)]?.targetWeightDelta, 3.5);
	assert.equal(comparison?.cells[cellComparisonKey(1, 0)]?.pctDelta, null);
	assert.equal(comparison?.hasChanges, true);
});

test('detects protocol and session changes and compares against the prior applicable slot', () => {
	const previous = row(100, 'Субмаксимальный', [cell(1, 0, 70), cell(1, 1, 0, 70, false)]);
	const current = row(100, 'Поддерживающий', [cell(1, 0, 0, 75, false), cell(1, 1, 75, 75)]);
	const comparison = compareExercisePlan(current, previous, {
		previousSessions: [0],
		currentSessions: [1]
	});
	const changedCell = comparison?.cells[cellComparisonKey(1, 1)];

	assert.equal(comparison?.protocolChanged, true);
	assert.equal(comparison?.sessionChanged, true);
	assert.deepEqual(comparison?.previousSessions, [0]);
	assert.deepEqual(comparison?.currentSessions, [1]);
	assert.equal(changedCell?.previousSessionIndex, 0);
	assert.equal(changedCell?.targetWeightDelta, 5);
	assert.equal(changedCell?.pctDelta, 5);
});

test('keeps an unchanged shared exercise free of comparison noise', () => {
	const previous = row(100, 'Субмаксимальный', [cell(1, 0, 70)]);
	const current = row(100, 'Субмаксимальный', [cell(1, 0, 70)]);
	const comparison = compareExercisePlan(current, previous);

	assert.equal(comparison?.hasChanges, false);
	assert.deepEqual(comparison?.cells, {});
});

test('does not compare a newly added exercise', () => {
	assert.equal(compareExercisePlan(row(100, 'Субмаксимальный', [cell(1, 0, 70)]), undefined), null);
});
