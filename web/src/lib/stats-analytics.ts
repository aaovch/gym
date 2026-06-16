import { fmtNum } from '$lib/format';
import type { StrengthSummary, TrendPoint } from '$lib/types';

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

export function buildAnalyticsInsights(input: {
	recentDays: number;
	recentPrCount: number;
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

	if (input.recentPrCount > 0) {
		items.push({
			id: 'prs',
			tone: 'good',
			title: 'Свежие рекорды',
			detail: `${input.recentPrCount} ${input.recentPrCount === 1 ? 'упражнение' : 'упражнений'} с лучшим 1ПМ за последний месяц.`
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
