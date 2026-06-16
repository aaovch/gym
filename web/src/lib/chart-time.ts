import { formatDateRu } from './format';
import type { TrendPoint } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Пропуск считается перерывом, если между сессиями больше 3 недель. */
export const TRAINING_GAP_DAYS = 21;

export type ChartPadding = {
	left: number;
	right: number;
	top: number;
	bottom: number;
};

export type TimeChartGap = {
	startDate: string;
	endDate: string;
	startX: number;
	endX: number;
	days: number;
	weeks: number;
	label: string;
	long: boolean;
};

export type TimeChartTick = {
	x: number;
	label: string;
};

export type TimeChartLayout = {
	width: number;
	height: number;
	padding: ChartPadding;
	plotTop: number;
	plotBottom: number;
	plotHeight: number;
	pointX: (index: number) => number;
	segments: TrendPoint[][];
	gaps: TimeChartGap[];
	dateTicks: TimeChartTick[];
	spanDays: number;
	startDate: string;
	endDate: string;
};

export function dateToMs(iso: string): number {
	const [y, m, d] = iso.split('-').map(Number);
	return Date.UTC(y, m - 1, d);
}

function daysBetween(a: string, b: string): number {
	return Math.round((dateToMs(b) - dateToMs(a)) / DAY_MS);
}

export function formatGapLabel(days: number): string {
	const weeks = Math.round(days / 7);
	if (days <= TRAINING_GAP_DAYS) return `${days} дн.`;
	if (weeks < 8) return `${weeks} нед.`;
	const months = Math.round(days / 30);
	return months === 1 ? '~1 мес.' : `~${months} мес.`;
}

function formatTickLabel(iso: string, spanDays: number): string {
	if (spanDays > 400) {
		const [y, m] = iso.split('-');
		return `${m}.${y.slice(2)}`;
	}
	if (spanDays > 90) {
		const [, m, d] = iso.split('-');
		return `${d}.${m}`;
	}
	return formatDateRu(iso);
}

function buildDateTicks(
	sorted: TrendPoint[],
	pointX: (index: number) => number,
	spanDays: number,
	maxTicks: number
): TimeChartTick[] {
	if (sorted.length === 0) return [];
	if (sorted.length <= maxTicks) {
		return sorted.map((point, index) => ({
			x: pointX(index),
			label: formatTickLabel(point.date, spanDays)
		}));
	}

	const ticks: TimeChartTick[] = [];
	for (let i = 0; i < maxTicks; i++) {
		const index = Math.round((i / (maxTicks - 1)) * (sorted.length - 1));
		ticks.push({
			x: pointX(index),
			label: formatTickLabel(sorted[index].date, spanDays)
		});
	}
	return ticks;
}

export function buildTimeChartLayout(
	points: TrendPoint[],
	options: {
		width?: number;
		height?: number;
		padding?: ChartPadding;
		gapDays?: number;
		maxTicks?: number;
		minPointSpacing?: number;
	} = {}
): TimeChartLayout | null {
	if (points.length === 0) return null;

	const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
	const gapDays = options.gapDays ?? TRAINING_GAP_DAYS;
	const padding = options.padding ?? { left: 44, right: 12, top: 12, bottom: 28 };
	const minPointSpacing = options.minPointSpacing ?? 24;
	const height = options.height ?? 200;
	const plotTop = padding.top;
	const plotBottom = height - padding.bottom;
	const plotHeight = plotBottom - plotTop;
	const width =
		options.width ??
		Math.max(640, padding.left + padding.right + Math.max(sorted.length - 1, 1) * minPointSpacing);
	const plotWidth = width - padding.left - padding.right;

	const spanDays = Math.max(daysBetween(sorted[0].date, sorted[sorted.length - 1].date), 1);

	const pointX = (index: number) => {
		if (sorted.length === 1) return padding.left + plotWidth / 2;
		return padding.left + (index / (sorted.length - 1)) * plotWidth;
	};

	const segments: TrendPoint[][] = [];
	const gaps: TimeChartGap[] = [];
	let current: TrendPoint[] = [sorted[0]];

	for (let i = 1; i < sorted.length; i++) {
		const prev = sorted[i - 1];
		const cur = sorted[i];
		const gap = daysBetween(prev.date, cur.date);

		if (gap > gapDays) {
			const weeks = Math.round(gap / 7);
			gaps.push({
				startDate: prev.date,
				endDate: cur.date,
				startX: pointX(i - 1),
				endX: pointX(i),
				days: gap,
				weeks,
				label: formatGapLabel(gap),
				long: weeks >= 6
			});
			segments.push(current);
			current = [cur];
		} else {
			current.push(cur);
		}
	}
	segments.push(current);

	const dateTicks = buildDateTicks(sorted, pointX, spanDays, options.maxTicks ?? 6);

	return {
		width,
		height,
		padding,
		plotTop,
		plotBottom,
		plotHeight,
		pointX,
		segments,
		gaps,
		dateTicks,
		spanDays,
		startDate: sorted[0].date,
		endDate: sorted[sorted.length - 1].date
	};
}

export function yScale(value: number, min: number, max: number, plotTop: number, plotBottom: number): number {
	const span = Math.max(max - min, 1);
	return plotBottom - ((value - min) / span) * (plotBottom - plotTop);
}
