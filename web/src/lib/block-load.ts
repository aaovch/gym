import {
	getMovementBlock,
	MOVEMENT_BLOCKS,
	type MovementBlock,
	type MovementBlockId
} from './muscle-groups';
import type { WorkoutEntry } from './types';

export type LoadMetric = 'tonnage' | 'reps' | 'sets';

export type BlockLoadTotals = {
	tonnage: number;
	reps: number;
	sets: number;
	sessions: number;
	exerciseCount: number;
};

export type BlockLoadWeek = {
	weekStart: string;
	blocks: Partial<Record<MovementBlockId, BlockLoadTotals>>;
	total: BlockLoadTotals;
};

export type BlockLoadSummary = {
	block: MovementBlock;
	totals: BlockLoadTotals;
	shareTonnage: number;
	shareReps: number;
	shareSets: number;
	trendTonnage: number | null;
	trendReps: number | null;
	weekly: { weekStart: string; tonnage: number; reps: number; sets: number }[];
};

const EMPTY_TOTALS = (): BlockLoadTotals => ({
	tonnage: 0,
	reps: 0,
	sets: 0,
	sessions: 0,
	exerciseCount: 0
});

export function weekStart(iso: string): string {
	const date = new Date(`${iso}T12:00:00`);
	const day = date.getDay();
	const diff = day === 0 ? -6 : 1 - day;
	date.setDate(date.getDate() + diff);
	return date.toISOString().slice(0, 10);
}

function addEntryMetrics(
	target: BlockLoadTotals,
	sets: WorkoutEntry['sets'],
	exercise: string,
	seenExercises: Set<string>
) {
	if (!seenExercises.has(exercise)) {
		seenExercises.add(exercise);
		target.exerciseCount += 1;
	}
	for (const set of sets) {
		const [first, second] = set;
		target.sets += 1;
		target.reps += second;
		target.tonnage += first * second;
	}
}

function metricValue(totals: BlockLoadTotals, metric: LoadMetric): number {
	if (metric === 'tonnage') return totals.tonnage;
	if (metric === 'reps') return totals.reps;
	return totals.sets;
}

export function buildBlockWeeklyLoad(entries: WorkoutEntry[]): BlockLoadWeek[] {
	const weekMap = new Map<string, BlockLoadWeek>();
	const weekSessions = new Map<string, Map<MovementBlockId, Set<string>>>();

	for (const entry of entries) {
		if (entry.kind !== 'strength') continue;
		const blockId = getMovementBlock(entry.exercise);
		if (!blockId) continue;

		const start = weekStart(entry.date);
		if (!weekMap.has(start)) {
			weekMap.set(start, { weekStart: start, blocks: {}, total: EMPTY_TOTALS() });
		}
		const week = weekMap.get(start)!;

		if (!week.blocks[blockId]) week.blocks[blockId] = EMPTY_TOTALS();
		const blockTotals = week.blocks[blockId]!;

		const sessionKey = `${blockId}:${entry.date}`;
		if (!weekSessions.has(start)) weekSessions.set(start, new Map());
		const sessionsByBlock = weekSessions.get(start)!;
		if (!sessionsByBlock.has(blockId)) sessionsByBlock.set(blockId, new Set());
		const dates = sessionsByBlock.get(blockId)!;
		if (!dates.has(entry.date)) {
			dates.add(entry.date);
			blockTotals.sessions += 1;
			week.total.sessions += 1;
		}

		const blockExercises = new Set<string>();
		addEntryMetrics(blockTotals, entry.sets, entry.exercise, blockExercises);
		if (blockExercises.size) {
			blockTotals.exerciseCount = blockExercises.size;
		}

		const weekExercises = new Set<string>();
		addEntryMetrics(week.total, entry.sets, entry.exercise, weekExercises);
	}

	return [...weekMap.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export function filterWeeksFrom(weeks: BlockLoadWeek[], fromDate: string | null): BlockLoadWeek[] {
	if (!fromDate) return weeks;
	return weeks.filter((week) => week.weekStart >= fromDate);
}

export function aggregateBlockTotals(
	weeks: BlockLoadWeek[],
	blockId: MovementBlockId
): BlockLoadTotals {
	const totals = EMPTY_TOTALS();
	for (const week of weeks) {
		const block = week.blocks[blockId];
		if (!block) continue;
		totals.tonnage += block.tonnage;
		totals.reps += block.reps;
		totals.sets += block.sets;
		totals.sessions += block.sessions;
		totals.exerciseCount = Math.max(totals.exerciseCount, block.exerciseCount);
	}
	return totals;
}

export function aggregateAllBlocks(weeks: BlockLoadWeek[]): Partial<Record<MovementBlockId, BlockLoadTotals>> {
	const result: Partial<Record<MovementBlockId, BlockLoadTotals>> = {};
	for (const block of MOVEMENT_BLOCKS) {
		const totals = aggregateBlockTotals(weeks, block.id);
		if (totals.tonnage > 0 || totals.reps > 0 || totals.sets > 0) {
			result[block.id] = totals;
		}
	}
	return result;
}

export function blocksWithLoad(weeks: BlockLoadWeek[]): MovementBlockId[] {
	const ids = new Set<MovementBlockId>();
	for (const week of weeks) {
		for (const id of Object.keys(week.blocks) as MovementBlockId[]) {
			ids.add(id);
		}
	}
	return MOVEMENT_BLOCKS.filter((block) => ids.has(block.id)).map((block) => block.id);
}

export function pctChange(current: number, previous: number): number | null {
	if (previous <= 0 && current <= 0) return null;
	if (previous <= 0) return 100;
	return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function buildBlockSummaries(
	allWeeks: BlockLoadWeek[],
	windowWeeks: number,
	trendWeeks: number
): BlockLoadSummary[] {
	const activeWeeks = windowWeeks > 0 ? allWeeks.slice(-windowWeeks) : allWeeks;
	const priorWeeks =
		windowWeeks > 0 && allWeeks.length > windowWeeks
			? allWeeks.slice(-windowWeeks * 2, -windowWeeks)
			: [];

	const parallel = aggregateAllBlocks(activeWeeks);
	const totalTonnage = Object.values(parallel).reduce((sum, row) => sum + (row?.tonnage ?? 0), 0);
	const totalReps = Object.values(parallel).reduce((sum, row) => sum + (row?.reps ?? 0), 0);
	const totalSets = Object.values(parallel).reduce((sum, row) => sum + (row?.sets ?? 0), 0);

	return blocksWithLoad(allWeeks).map((blockId) => {
		const block = MOVEMENT_BLOCKS.find((item) => item.id === blockId)!;
		const totals = parallel[blockId] ?? EMPTY_TOTALS();
		const currentTrend = aggregateBlockTotals(activeWeeks.slice(-trendWeeks), blockId);
		const priorTrend = aggregateBlockTotals(priorWeeks.slice(-trendWeeks), blockId);

		const weekly = activeWeeks.map((week) => ({
			weekStart: week.weekStart,
			tonnage: week.blocks[blockId]?.tonnage ?? 0,
			reps: week.blocks[blockId]?.reps ?? 0,
			sets: week.blocks[blockId]?.sets ?? 0
		}));

		return {
			block,
			totals,
			shareTonnage: totalTonnage ? Math.round((totals.tonnage / totalTonnage) * 1000) / 10 : 0,
			shareReps: totalReps ? Math.round((totals.reps / totalReps) * 1000) / 10 : 0,
			shareSets: totalSets ? Math.round((totals.sets / totalSets) * 1000) / 10 : 0,
			trendTonnage: pctChange(currentTrend.tonnage, priorTrend.tonnage),
			trendReps: pctChange(currentTrend.reps, priorTrend.reps),
			weekly
		};
	});
}

export function formatMetric(value: number, metric: LoadMetric): string {
	if (metric === 'tonnage') {
		if (value >= 1000) return `${Math.round(value / 100) / 10}т`;
		return `${Math.round(value)} кг×`;
	}
	if (metric === 'reps') return `${Math.round(value)} повт.`;
	return `${Math.round(value)} подх.`;
}

export function metricLabel(metric: LoadMetric): string {
	if (metric === 'tonnage') return 'Тоннаж';
	if (metric === 'reps') return 'Повторы';
	return 'Подходы';
}

export function metricLabelGenitive(metric: LoadMetric): string {
	if (metric === 'tonnage') return 'тоннажа';
	if (metric === 'reps') return 'повторов';
	return 'подходов';
}

export function weeksAgoIso(weeks: number): string {
	const date = new Date(`${new Date().toISOString().slice(0, 10)}T12:00:00`);
	date.setDate(date.getDate() - weeks * 7);
	return weekStart(date.toISOString().slice(0, 10));
}

export function unmappedStrengthExercises(entries: WorkoutEntry[]): string[] {
	const names = new Set<string>();
	for (const entry of entries) {
		if (entry.kind !== 'strength') continue;
		if (!getMovementBlock(entry.exercise)) names.add(entry.exercise);
	}
	return [...names].sort((a, b) => a.localeCompare(b, 'ru'));
}
