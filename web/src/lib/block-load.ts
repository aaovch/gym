import { fmtNum } from './format';
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
	trendSets: number | null;
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
	windowWeeks: number
): BlockLoadSummary[] {
	// Тренд: выбранное окно против равного по длине предыдущего окна.
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
		const priorTotals = aggregateBlockTotals(priorWeeks, blockId);

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
			trendTonnage: pctChange(totals.tonnage, priorTotals.tonnage),
			trendReps: pctChange(totals.reps, priorTotals.reps),
			trendSets: pctChange(totals.sets, priorTotals.sets),
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

export function metricDefinition(metric: LoadMetric): string {
	if (metric === 'tonnage') return 'Тоннаж = вес × повторы. Общий объём поднятого за период.';
	if (metric === 'reps') return 'Повторы — сколько раз выполнено движение. Вес не учитывается.';
	return 'Подходы — количество рабочих сетов. Грубая оценка частоты стимула.';
}

export function metricUnit(metric: LoadMetric): string {
	if (metric === 'tonnage') return 'тоннажу';
	if (metric === 'reps') return 'повторам';
	return 'подходам';
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

export function blockExerciseNames(entries: WorkoutEntry[], blockId: MovementBlockId): string[] {
	const names = new Set<string>();
	for (const entry of entries) {
		if (entry.kind !== 'strength') continue;
		if (getMovementBlock(entry.exercise) === blockId) names.add(entry.exercise);
	}
	return [...names].sort((a, b) => a.localeCompare(b, 'ru'));
}

export function unmappedStrengthExercises(entries: WorkoutEntry[]): string[] {
	const names = new Set<string>();
	for (const entry of entries) {
		if (entry.kind !== 'strength') continue;
		if (!getMovementBlock(entry.exercise)) names.add(entry.exercise);
	}
	return [...names].sort((a, b) => a.localeCompare(b, 'ru'));
}

export type LoadInsightTone = 'warn' | 'ok' | 'info';

export type LoadInsight = {
	id: string;
	tone: LoadInsightTone;
	title: string;
	detail: string;
};

const PUSH_BLOCKS: MovementBlockId[] = ['horizontal_push', 'vertical_push'];
const PULL_BLOCKS: MovementBlockId[] = ['horizontal_pull', 'vertical_pull'];

function summaryShare(summary: BlockLoadSummary, metric: LoadMetric): number {
	if (metric === 'tonnage') return summary.shareTonnage;
	if (metric === 'reps') return summary.shareReps;
	return summary.shareSets;
}

function summaryTrend(summary: BlockLoadSummary, metric: LoadMetric): number | null {
	if (metric === 'tonnage') return summary.trendTonnage;
	if (metric === 'reps') return summary.trendReps;
	return summary.trendSets;
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

/**
 * Простая интерпретация нагрузки по правилам: баланс жимов/тяг, выпавшие
 * паттерны, разброс долей и заметные спады. Без выдуманных метрик.
 */
export function buildLoadInsights(summaries: BlockLoadSummary[], metric: LoadMetric): LoadInsight[] {
	const insights: LoadInsight[] = [];
	const active = summaries.filter((item) => metricValue(item.totals, metric) > 0);
	if (active.length === 0) return insights;

	const unit = metricLabelGenitive(metric);

	const push = summaries
		.filter((item) => PUSH_BLOCKS.includes(item.block.id))
		.reduce((sum, item) => sum + metricValue(item.totals, metric), 0);
	const pull = summaries
		.filter((item) => PULL_BLOCKS.includes(item.block.id))
		.reduce((sum, item) => sum + metricValue(item.totals, metric), 0);

	if (push > 0 && pull === 0) {
		insights.push({
			id: 'push-pull',
			tone: 'warn',
			title: 'Есть жимы, но нет тяг',
			detail: 'Жимы без тяг перекашивают плечевой пояс. Добавьте тяговые движения.'
		});
	} else if (pull > 0 && push === 0) {
		insights.push({
			id: 'push-pull',
			tone: 'warn',
			title: 'Есть тяги, но нет жимов',
			detail: 'Добавьте жимовые движения, чтобы выровнять баланс плечевого пояса.'
		});
	} else if (push > 0 && pull > 0) {
		const ratio = push / pull;
		if (ratio >= 1.5) {
			insights.push({
				id: 'push-pull',
				tone: 'warn',
				title: `Жимов больше тяг в ${fmtNum(round1(ratio))}×`,
				detail: 'Для баланса плечевого пояса добавьте тяги — горизонтальные и вертикальные.'
			});
		} else if (ratio <= 1 / 1.5) {
			insights.push({
				id: 'push-pull',
				tone: 'warn',
				title: `Тяг больше жимов в ${fmtNum(round1(1 / ratio))}×`,
				detail: 'Добавьте жимы, чтобы выровнять баланс плечевого пояса.'
			});
		} else {
			insights.push({
				id: 'push-pull',
				tone: 'ok',
				title: 'Баланс жимов и тяг в норме',
				detail: `Соотношение близко к 1:1 по ${unit}.`
			});
		}
	}

	const missing = summaries.filter((item) => metricValue(item.totals, metric) === 0);
	if (missing.length > 0) {
		insights.push({
			id: 'missing',
			tone: 'warn',
			title: `В этом периоде нет нагрузки: ${missing.map((item) => item.block.label).join(', ')}`,
			detail:
				'Раньше эти паттерны встречались, но в выбранном окне их нет — возможно, выпали из плана.'
		});
	}

	const ranked = [...active].sort(
		(a, b) => metricValue(b.totals, metric) - metricValue(a.totals, metric)
	);
	if (ranked.length >= 2) {
		const top = ranked[0];
		const bottom = ranked[ranked.length - 1];
		insights.push({
			id: 'spread',
			tone: 'info',
			title: `Больше всего — ${top.block.label} (${fmtNum(summaryShare(top, metric))}%), меньше — ${bottom.block.label} (${fmtNum(summaryShare(bottom, metric))}%)`,
			detail: `Доли по ${unit} за выбранный период.`
		});
	}

	const biggestDrop = ranked
		.filter((item) => (summaryTrend(item, metric) ?? 0) <= -40)
		.sort((a, b) => (summaryTrend(a, metric) ?? 0) - (summaryTrend(b, metric) ?? 0))[0];
	if (biggestDrop) {
		insights.push({
			id: 'drop',
			tone: 'warn',
			title: `${biggestDrop.block.label}: спад ${fmtNum(summaryTrend(biggestDrop, metric) ?? 0)}%`,
			detail: 'Нагрузка на блок заметно снизилась относительно предыдущего периода — проверьте, так ли задумано.'
		});
	}

	const order: Record<LoadInsightTone, number> = { warn: 0, ok: 1, info: 2 };
	return insights.sort((a, b) => order[a.tone] - order[b.tone]);
}

export type BalancePair = {
	id: string;
	label: string;
	leftLabel: string;
	rightLabel: string;
	left: number;
	right: number;
	leftShare: number;
	rightShare: number;
	leftColor: string;
	rightColor: string;
	tone: LoadInsightTone;
	note: string;
};

type BalanceDef = {
	id: string;
	label: string;
	leftLabel: string;
	rightLabel: string;
	leftIds: MovementBlockId[];
	rightIds: MovementBlockId[];
	leftColor: string;
	rightColor: string;
	judge: boolean;
};

const BALANCE_DEFS: BalanceDef[] = [
	{
		id: 'push-pull',
		label: 'Жимы и тяги',
		leftLabel: 'Жимы',
		rightLabel: 'Тяги',
		leftIds: ['horizontal_push', 'vertical_push'],
		rightIds: ['horizontal_pull', 'vertical_pull'],
		leftColor: '#5b9dff',
		rightColor: '#f472b6',
		judge: true
	},
	{
		id: 'lower-upper',
		label: 'Ноги и верх тела',
		leftLabel: 'Ноги',
		rightLabel: 'Верх',
		leftIds: ['knee_dominant', 'hip_dominant'],
		rightIds: ['horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull', 'arms'],
		leftColor: '#ccff33',
		rightColor: '#a78bfa',
		judge: false
	}
];

export function buildBalancePairs(summaries: BlockLoadSummary[], metric: LoadMetric): BalancePair[] {
	const byId = new Map(summaries.map((item) => [item.block.id, item]));
	const sumIds = (ids: MovementBlockId[]) =>
		ids.reduce((sum, id) => {
			const item = byId.get(id);
			return sum + (item ? metricValue(item.totals, metric) : 0);
		}, 0);

	const pairs: BalancePair[] = [];

	for (const def of BALANCE_DEFS) {
		const left = sumIds(def.leftIds);
		const right = sumIds(def.rightIds);
		const total = left + right;
		if (total <= 0) continue;

		const leftShare = Math.round((left / total) * 1000) / 10;
		const rightShare = Math.round((right / total) * 1000) / 10;

		let tone: LoadInsightTone = 'info';
		let note = 'Соотношение зависит от целей и фазы — здесь просто факт.';

		if (def.judge) {
			if (right === 0) {
				tone = 'warn';
				note = `Нет нагрузки на «${def.rightLabel.toLowerCase()}» — добавьте эти движения.`;
			} else if (left === 0) {
				tone = 'warn';
				note = `Нет нагрузки на «${def.leftLabel.toLowerCase()}» — добавьте эти движения.`;
			} else {
				const ratio = left / right;
				if (ratio >= 1.5) {
					tone = 'warn';
					note = `${def.leftLabel} больше ${def.rightLabel.toLowerCase()} в ${fmtNum(round1(ratio))}× — добавьте «${def.rightLabel.toLowerCase()}».`;
				} else if (ratio <= 1 / 1.5) {
					tone = 'warn';
					note = `${def.rightLabel} больше ${def.leftLabel.toLowerCase()} в ${fmtNum(round1(1 / ratio))}× — добавьте «${def.leftLabel.toLowerCase()}».`;
				} else {
					tone = 'ok';
					note = 'Баланс близок к 1:1.';
				}
			}
		}

		pairs.push({
			id: def.id,
			label: def.label,
			leftLabel: def.leftLabel,
			rightLabel: def.rightLabel,
			left,
			right,
			leftShare,
			rightShare,
			leftColor: def.leftColor,
			rightColor: def.rightColor,
			tone,
			note
		});
	}

	return pairs;
}
