import { fmtNum } from '$lib/format';
import { dateToMs, msToIso } from '$lib/chart-time';
import type { StrengthSummary, TrendPoint } from '$lib/types';

export type DateRange = {
	from: string;
	to: string;
};

export type PeriodPresetKey = 'all' | '30d' | '90d' | '180d' | '365d' | 'custom';

export type TrendPeriodSummary = {
	from: string;
	to: string;
	sessions: number;
	deltaPct: number | null;
	start1rm: number;
	end1rm: number;
	best1rm: { value: number; date: string };
	bestSet: { weight: number; reps: number; date: string };
	avgIntensity: number;
};

export const PERIOD_PRESETS: { key: PeriodPresetKey; label: string; days: number | null }[] = [
	{ key: 'all', label: 'Всё', days: null },
	{ key: '30d', label: '30 дн', days: 30 },
	{ key: '90d', label: '3 мес', days: 90 },
	{ key: '180d', label: '6 мес', days: 180 },
	{ key: '365d', label: '12 мес', days: 365 }
];

export type SortKey = 'sessions' | '1rm' | 'recent' | 'name';
export type InsightTone = 'good' | 'warn' | 'neutral';

export type AnalyticsInsight = {
	id: string;
	tone: InsightTone;
	title: string;
	detail: string;
};

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
	{ key: 'sessions', label: 'Сессии' },
	{ key: '1rm', label: '1ПМ' },
	{ key: 'recent', label: 'Недавние' },
	{ key: 'name', label: 'А–Я' }
];

const EXERCISE_COLORS = ['#6ee7a8', '#5b9dff', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c'] as const;

export function exerciseColor(name: string): string {
	let hash = 0;
	for (let i = 0; i < name.length; i += 1) {
		hash = (hash + name.charCodeAt(i) * (i + 1)) % EXERCISE_COLORS.length;
	}
	return EXERCISE_COLORS[hash];
}

export function trendDelta(points: TrendPoint[]): number | null {
	if (points.length < 2) return null;
	const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
	const first = sorted[0].est1rm;
	const last = sorted[sorted.length - 1].est1rm;
	if (!first) return null;
	return ((last - first) / first) * 100;
}

export function sortTrendPoints(points: TrendPoint[]): TrendPoint[] {
	return [...points].sort((a, b) => a.date.localeCompare(b.date));
}

export function filterTrendByRange(points: TrendPoint[], range: DateRange | null): TrendPoint[] {
	const sorted = sortTrendPoints(points);
	if (!range) return sorted;
	return sorted.filter((point) => point.date >= range.from && point.date <= range.to);
}

export function presetPeriodRange(points: TrendPoint[], days: number | null): DateRange | null {
	const sorted = sortTrendPoints(points);
	if (sorted.length === 0) return null;
	const to = sorted[sorted.length - 1].date;
	if (days == null) {
		return { from: sorted[0].date, to };
	}
	const fromMs = dateToMs(to) - (days - 1) * 86400000;
	const from = msToIso(fromMs);
	return { from: from < sorted[0].date ? sorted[0].date : from, to };
}

export function summarizeTrendPeriod(
	points: TrendPoint[],
	range: DateRange | null
): TrendPeriodSummary | null {
	const filtered = filterTrendByRange(points, range);
	if (filtered.length === 0) return null;

	const best1rmPoint = filtered.reduce((best, point) =>
		point.est1rm > best.est1rm ? point : best
	);
	const bestWeightPoint = filtered.reduce((best, point) =>
		point.maxWeight > best.maxWeight ||
		(point.maxWeight === best.maxWeight && point.maxReps > best.maxReps)
			? point
			: best
	);

	return {
		from: filtered[0].date,
		to: filtered[filtered.length - 1].date,
		sessions: filtered.length,
		deltaPct: trendDelta(filtered),
		start1rm: filtered[0].est1rm,
		end1rm: filtered[filtered.length - 1].est1rm,
		best1rm: { value: best1rmPoint.est1rm, date: best1rmPoint.date },
		bestSet: {
			weight: bestWeightPoint.maxWeight,
			reps: bestWeightPoint.maxReps,
			date: bestWeightPoint.date
		},
		avgIntensity: filtered.reduce((sum, point) => sum + point.avgIntensity, 0) / filtered.length
	};
}

export function rangeFromSvgDates(
	points: TrendPoint[],
	fromDate: string,
	toDate: string
): DateRange | null {
	const start = fromDate <= toDate ? fromDate : toDate;
	const end = fromDate <= toDate ? toDate : fromDate;
	const filtered = filterTrendByRange(points, { from: start, to: end });
	if (filtered.length === 0) return null;
	return { from: filtered[0].date, to: filtered[filtered.length - 1].date };
}

export function sparklinePath(points: TrendPoint[]): string {
	if (points.length < 2) return '';
	const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
	const values = sorted.map((point) => point.est1rm);
	const min = Math.min(...values);
	const max = Math.max(...values);
	const width = 52;
	const height = 18;
	return sorted
		.map((point, index) => {
			const x = (index / (sorted.length - 1)) * width;
			const y =
				max === min ? height / 2 : height - ((point.est1rm - min) / (max - min)) * height;
			return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
		})
		.join(' ');
}

export function sortStrengthSummary(list: StrengthSummary[], sortKey: SortKey): StrengthSummary[] {
	const copy = [...list];
	switch (sortKey) {
		case '1rm':
			return copy.sort((a, b) => b.best1rm.value - a.best1rm.value);
		case 'recent':
			return copy.sort((a, b) => (b.periodEnd ?? '').localeCompare(a.periodEnd ?? ''));
		case 'name':
			return copy.sort((a, b) => a.exercise.localeCompare(b.exercise, 'ru'));
		default:
			return copy.sort((a, b) => b.sessions - a.sessions);
	}
}

export function recentPrRecords(summary: StrengthSummary[], sinceIso: string) {
	return summary
		.filter((item) => item.best1rm.date && item.best1rm.date >= sinceIso)
		.map((item) => ({
			exercise: item.exercise,
			value: item.best1rm.value,
			date: item.best1rm.date!
		}))
		.sort(
			(a, b) => b.date.localeCompare(a.date) || a.exercise.localeCompare(b.exercise, 'ru')
		);
}

export function buildAnalyticsInsights(input: {
	recentDays: number;
	strongest: StrengthSummary[];
}): AnalyticsInsight[] {
	const items: AnalyticsInsight[] = [];

	if (input.recentDays >= 12) {
		items.push({
			id: 'rhythm',
			tone: 'good',
			title: 'Стабильный ритм',
			detail: `${input.recentDays} тренировочных дней за 30 дней — хорошая регулярность.`
		});
	} else if (input.recentDays > 0) {
		items.push({
			id: 'rhythm-low',
			tone: 'warn',
			title: 'Мало регулярности',
			detail: `${input.recentDays} из 30 дней с тренировками. Для прогресса обычно нужно 8–12+.`
		});
	}

	if (input.strongest.length >= 2) {
		items.push({
			id: 'anchor',
			tone: 'neutral',
			title: 'Якорное движение',
			detail: `${input.strongest[0].exercise} — лидер по расчётному 1ПМ (${fmtNum(input.strongest[0].best1rm.value)} кг).`
		});
	}

	return items.slice(0, 3);
}

export function statsUrl(base: string, params: URLSearchParams): string {
	const qs = params.toString();
	return qs ? `${base}/stats?${qs}` : `${base}/stats`;
}
