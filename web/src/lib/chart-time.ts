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

export function msToIso(ms: number): string {
	const d = new Date(ms);
	const y = d.getUTCFullYear();
	const m = String(d.getUTCMonth() + 1).padStart(2, '0');
	const day = String(d.getUTCDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

function daysBetween(a: string, b: string): number {
	return Math.round((dateToMs(b) - dateToMs(a)) / DAY_MS);
}

function chooseTickStepDays(spanDays: number): number {
	if (spanDays > 730) return 90;
	if (spanDays > 400) return 30;
	if (spanDays > 180) return 14;
	if (spanDays > 60) return 7;
	if (spanDays > 14) return 3;
	return 1;
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
	startMs: number,
	spanMs: number,
	xAtMs: (ms: number) => number,
	spanDays: number,
	maxTicks: number
): TimeChartTick[] {
	if (spanMs <= 0) return [];

	const stepMs = chooseTickStepDays(spanDays) * DAY_MS;
	const ticks: TimeChartTick[] = [];

	for (let ms = startMs; ms <= startMs + spanMs + stepMs / 2; ms += stepMs) {
		ticks.push({
			x: xAtMs(ms),
			label: formatTickLabel(msToIso(ms), spanDays)
		});
	}

	if (ticks.length <= maxTicks) return ticks;

	const stride = Math.ceil(ticks.length / maxTicks);
	return ticks.filter((_, index) => index % stride === 0 || index === ticks.length - 1);
}

function buildSameDayOffsets(sorted: TrendPoint[], minPointSpacing: number): Map<number, number> {
	const byDate = new Map<string, number[]>();
	for (let index = 0; index < sorted.length; index++) {
		const indices = byDate.get(sorted[index].date) ?? [];
		indices.push(index);
		byDate.set(sorted[index].date, indices);
	}

	const offsets = new Map<number, number>();
	const maxOffset = Math.min(minPointSpacing * 0.45, 10);

	for (const indices of byDate.values()) {
		if (indices.length === 1) continue;
		const center = (indices.length - 1) / 2;
		for (let position = 0; position < indices.length; position++) {
			offsets.set(indices[position], (position - center) * maxOffset);
		}
	}

	return offsets;
}

function computePlotWidth(
	sorted: TrendPoint[],
	padding: ChartPadding,
	minPointSpacing: number,
	minTotalWidth: number
): number {
	const minPlotWidth = minTotalWidth - padding.left - padding.right;
	if (sorted.length <= 1) return minPlotWidth;

	const startMs = dateToMs(sorted[0].date);
	const endMs = dateToMs(sorted[sorted.length - 1].date);
	const spanMs = Math.max(endMs - startMs, DAY_MS);

	let minGapMs = spanMs;
	for (let index = 1; index < sorted.length; index++) {
		const gapMs = dateToMs(sorted[index].date) - dateToMs(sorted[index - 1].date);
		if (gapMs > 0) minGapMs = Math.min(minGapMs, gapMs);
	}

	const byDate = new Map<string, number>();
	for (const point of sorted) {
		byDate.set(point.date, (byDate.get(point.date) ?? 0) + 1);
	}
	const maxSameDay = Math.max(...byDate.values(), 1);

	return Math.max(
		minPlotWidth,
		(spanMs / minGapMs) * minPointSpacing,
		(maxSameDay - 1) * minPointSpacing * 0.45
	);
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
	const minTotalWidth = 640;
	const plotWidth =
		options.width != null
			? options.width - padding.left - padding.right
			: computePlotWidth(sorted, padding, minPointSpacing, minTotalWidth);
	const width = options.width ?? padding.left + padding.right + plotWidth;

	const startMs = dateToMs(sorted[0].date);
	const endMs = dateToMs(sorted[sorted.length - 1].date);
	const spanMs = Math.max(endMs - startMs, DAY_MS);
	const spanDays = Math.max(daysBetween(sorted[0].date, sorted[sorted.length - 1].date), 1);
	const sameDayOffsets = buildSameDayOffsets(sorted, minPointSpacing);

	const xAtMs = (ms: number) => {
		if (sorted.length === 1) return padding.left + plotWidth / 2;
		return padding.left + ((ms - startMs) / spanMs) * plotWidth;
	};

	const pointX = (index: number) => xAtMs(dateToMs(sorted[index].date)) + (sameDayOffsets.get(index) ?? 0);

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

	const dateTicks = buildDateTicks(startMs, spanMs, xAtMs, spanDays, options.maxTicks ?? 6);

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
