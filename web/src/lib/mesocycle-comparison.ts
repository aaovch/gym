import type { ProtocolMatrixCell, ProtocolMatrixRow } from './cycle-plan';

export type CellPlanComparison = {
	targetWeightDelta: number | null;
	pctDelta: number | null;
	previousSessionIndex: 0 | 1 | null;
	newlyApplicable: boolean;
};

export type ExercisePlanComparison = {
	anchorDelta: number | null;
	anchorPctDelta: number | null;
	protocolChanged: boolean;
	previousTemplateName: string;
	currentSessions: (0 | 1)[];
	previousSessions: (0 | 1)[];
	sessionChanged: boolean;
	cells: Record<string, CellPlanComparison>;
	hasChanges: boolean;
};

export type ExercisePlanComparisonOptions = {
	currentSessions?: readonly (0 | 1)[];
	previousSessions?: readonly (0 | 1)[];
};

const CHANGE_EPSILON = 0.05;

function meaningfulDelta(current: number | null, previous: number | null): number | null {
	if (current == null || previous == null) return null;
	const delta = current - previous;
	return Math.abs(delta) >= CHANGE_EPSILON ? delta : null;
}

function applicableSessions(row: ProtocolMatrixRow): (0 | 1)[] {
	return ([0, 1] as const).filter((sessionIndex) =>
		row.cells.some((cell) => cell.sessionIndex === sessionIndex && cell.applicable)
	);
}

function sameSessions(current: readonly (0 | 1)[], previous: readonly (0 | 1)[]): boolean {
	return current.length === previous.length && current.every((session, index) => session === previous[index]);
}

function previousCellFor(
	previous: ProtocolMatrixRow,
	currentCell: ProtocolMatrixCell
): ProtocolMatrixCell | null {
	return (
		previous.cells.find(
			(cell) =>
				cell.microIndex === currentCell.microIndex &&
				cell.sessionIndex === currentCell.sessionIndex &&
				cell.applicable
		) ??
		previous.cells.find((cell) => cell.microIndex === currentCell.microIndex && cell.applicable) ??
		null
	);
}

export function cellComparisonKey(microIndex: number, sessionIndex: 0 | 1): string {
	return `${microIndex}:${sessionIndex}`;
}

export function compareExercisePlan(
	current: ProtocolMatrixRow,
	previous: ProtocolMatrixRow | undefined,
	options: ExercisePlanComparisonOptions = {}
): ExercisePlanComparison | null {
	if (!previous) return null;

	const anchorDelta = meaningfulDelta(current.anchor, previous.anchor);
	const anchorPctDelta =
		anchorDelta != null && previous.anchor > 0 ? (anchorDelta / previous.anchor) * 100 : null;
	const currentSessions = [...(options.currentSessions ?? applicableSessions(current))];
	const previousSessions = [...(options.previousSessions ?? applicableSessions(previous))];
	const sessionChanged = !sameSessions(currentSessions, previousSessions);
	const protocolChanged = current.templateName !== previous.templateName;
	const cells: Record<string, CellPlanComparison> = {};

	for (const currentCell of current.cells.filter((cell) => cell.applicable)) {
		const previousCell = previousCellFor(previous, currentCell);
		const comparison: CellPlanComparison = {
			targetWeightDelta: previousCell
				? meaningfulDelta(currentCell.targetWeight, previousCell.targetWeight)
				: null,
			pctDelta: previousCell ? meaningfulDelta(currentCell.pct, previousCell.pct) : null,
			previousSessionIndex: previousCell?.sessionIndex ?? null,
			newlyApplicable: previousCell == null
		};
		if (
			comparison.targetWeightDelta != null ||
			comparison.pctDelta != null ||
			comparison.newlyApplicable
		) {
			cells[cellComparisonKey(currentCell.microIndex, currentCell.sessionIndex)] = comparison;
		}
	}

	return {
		anchorDelta,
		anchorPctDelta,
		protocolChanged,
		previousTemplateName: previous.templateName,
		currentSessions,
		previousSessions,
		sessionChanged,
		cells,
		hasChanges:
			anchorDelta != null ||
			protocolChanged ||
			sessionChanged ||
			Object.keys(cells).length > 0
	};
}
