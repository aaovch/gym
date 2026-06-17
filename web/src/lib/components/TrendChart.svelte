<script lang="ts">
	import { tick } from 'svelte';
	import {
		TRAINING_GAP_DAYS,
		buildTimeChartLayout,
		dateToMs,
		formatGapLabel,
		msToIso,
		yScale
	} from '$lib/chart-time';
	import { fmtNum, formatDateRu } from '$lib/format';
	import { rangeFromSvgDates, type DateRange } from '$lib/stats-analytics';
	import type { TrendPoint } from '$lib/types';

	let {
		title,
		points,
		color = '#6ee7a8',
		compact = false,
		gapDays = TRAINING_GAP_DAYS,
		range = null,
		onRangeChange,
		enableRangeSelect = false
	}: {
		title: string;
		points: TrendPoint[];
		color?: string;
		compact?: boolean;
		gapDays?: number;
		range?: DateRange | null;
		onRangeChange?: (range: DateRange | null) => void;
		enableRangeSelect?: boolean;
	} = $props();

	const layout = $derived(
		buildTimeChartLayout(points, {
			height: compact ? 168 : 230,
			gapDays,
			maxTicks: compact ? 4 : 8,
			minPointSpacing: compact ? 18 : 26
		})
	);

	const sortedPoints = $derived([...points].sort((a, b) => a.date.localeCompare(b.date)));

	const yMin = $derived(sortedPoints.length ? Math.min(...sortedPoints.map((p) => p.est1rm)) : 0);
	const yMax = $derived(sortedPoints.length ? Math.max(...sortedPoints.map((p) => p.est1rm)) : 0);

	let hoverIndex = $state<number | null>(null);
	let scrollEl = $state<HTMLDivElement | undefined>();
	let listEl = $state<HTMLUListElement | undefined>();
	let svgEl = $state<SVGSVGElement | undefined>();
	let dragStartX = $state<number | null>(null);
	let dragCurrentX = $state<number | null>(null);

	const displayPoints = $derived(
		range
			? sortedPoints.filter((point) => point.date >= range.from && point.date <= range.to)
			: sortedPoints
	);

	const selectionBand = $derived.by(() => {
		if (!layout || sortedPoints.length === 0) return null;
		const startMs = dateToMs(sortedPoints[0].date);
		const endMs = dateToMs(sortedPoints[sortedPoints.length - 1].date);
		const spanMs = Math.max(endMs - startMs, 86400000);
		const plotWidth = layout.width - layout.padding.left - layout.padding.right;

		const xAtMs = (ms: number) =>
			layout!.padding.left + ((ms - startMs) / spanMs) * plotWidth;

		if (dragStartX != null && dragCurrentX != null) {
			const left = Math.min(dragStartX, dragCurrentX);
			const right = Math.max(dragStartX, dragCurrentX);
			return { left, right, draft: true as const };
		}

		if (!range) return null;
		const left = xAtMs(dateToMs(range.from));
		const right = xAtMs(dateToMs(range.to));
		return { left, right, draft: false as const };
	});

	function showPoint(index: number) {
		hoverIndex = index;
	}

	function hidePoint() {
		hoverIndex = null;
	}

	function svgXFromClient(clientX: number): number {
		if (!svgEl || !layout) return 0;
		const rect = svgEl.getBoundingClientRect();
		const scale = layout.width / rect.width;
		return (clientX - rect.left) * scale;
	}

	function dateFromSvgX(x: number): string {
		if (!layout || sortedPoints.length === 0) return sortedPoints[0]?.date ?? todayIsoFallback();
		const plotLeft = layout.padding.left;
		const plotWidth = layout.width - layout.padding.left - layout.padding.right;
		const startMs = dateToMs(sortedPoints[0].date);
		const endMs = dateToMs(sortedPoints[sortedPoints.length - 1].date);
		const spanMs = Math.max(endMs - startMs, 86400000);
		const ratio = Math.min(1, Math.max(0, (x - plotLeft) / plotWidth));
		return msToIso(startMs + ratio * spanMs);
	}

	function todayIsoFallback(): string {
		return new Date().toISOString().slice(0, 10);
	}

	function finishRangeSelection() {
		if (dragStartX == null || dragCurrentX == null || !onRangeChange) {
			dragStartX = null;
			dragCurrentX = null;
			return;
		}
		const minDrag = 8;
		if (Math.abs(dragCurrentX - dragStartX) < minDrag) {
			onRangeChange(null);
		} else {
			const fromDate = dateFromSvgX(dragStartX);
			const toDate = dateFromSvgX(dragCurrentX);
			const next = rangeFromSvgDates(sortedPoints, fromDate, toDate);
			onRangeChange(next);
		}
		dragStartX = null;
		dragCurrentX = null;
	}

	function onSvgPointerDown(event: PointerEvent) {
		if (!enableRangeSelect || !onRangeChange) return;
		const target = event.target as Element;
		if (target.closest('.point-hit')) return;
		event.preventDefault();
		svgEl?.setPointerCapture(event.pointerId);
		dragStartX = svgXFromClient(event.clientX);
		dragCurrentX = dragStartX;
	}

	function onSvgPointerMove(event: PointerEvent) {
		if (dragStartX == null) return;
		dragCurrentX = svgXFromClient(event.clientX);
	}

	function onSvgPointerUp(event: PointerEvent) {
		if (dragStartX == null) return;
		svgEl?.releasePointerCapture(event.pointerId);
		finishRangeSelection();
	}

	function pointInRange(date: string): boolean {
		if (!range) return true;
		return date >= range.from && date <= range.to;
	}

	function scrollToLatest() {
		void tick().then(() => {
			if (scrollEl && scrollEl.scrollWidth > scrollEl.clientWidth) {
				// RTL container: scrollLeft 0 keeps the viewport on the latest dates.
				scrollEl.scrollLeft = 0;
			}
			if (listEl && listEl.scrollHeight > listEl.clientHeight) {
				listEl.scrollTop = listEl.scrollHeight - listEl.clientHeight;
			}
		});
	}

	$effect(() => {
		layout?.width;
		sortedPoints.length;
		sortedPoints.at(-1)?.date;
		scrollToLatest();
	});
</script>

<div class="chart-card" class:compact>
	<div class="chart-head">
		<div>
			<h4>{title}</h4>
			{#if layout && sortedPoints.length > 1}
				<p class="period-caption">
					{#if range}
						Период: {formatDateRu(range.from)} — {formatDateRu(range.to)} · {displayPoints.length}
						{displayPoints.length === 1 ? 'запись' : displayPoints.length < 5 ? 'записи' : 'записей'}
					{:else}
						{formatDateRu(layout.startDate)} — {formatDateRu(layout.endDate)} · {sortedPoints.length}
						{sortedPoints.length === 1 ? 'запись' : sortedPoints.length < 5 ? 'записи' : 'записей'}
					{/if}
				</p>
			{/if}
			{#if enableRangeSelect && !compact}
				<p class="range-hint">Выделите диапазон на графике, чтобы посмотреть сводку за период</p>
			{/if}
			{#if layout && layout.gaps.length > 0}
				<p class="gap-hint">
					Перерывы &gt; 3 нед.: <strong>{layout.gaps.length}</strong>
				</p>
			{/if}
		</div>
		{#if sortedPoints.length > 0}
			<span class="latest">
				{#if hoverIndex != null}
					{formatDateRu(sortedPoints[hoverIndex].date)} · {fmtNum(sortedPoints[hoverIndex].est1rm)} кг
				{:else}
					{fmtNum(sortedPoints[sortedPoints.length - 1].est1rm)} кг
				{/if}
			</span>
		{/if}
	</div>

	{#if layout && layout.gaps.length > 0}
		<ul class="gap-chips" class:compact>
			{#each layout.gaps as gap, gapIndex (`${gap.startDate}:${gap.endDate}:${gapIndex}`)}
				<li class="gap-chip" class:long={gap.long}>
					<span class="gap-chip-label">{gap.label}</span>
					<span class="gap-chip-dates">
						{formatDateRu(gap.startDate)} — {formatDateRu(gap.endDate)}
					</span>
				</li>
			{/each}
		</ul>
	{/if}

	{#if !layout}
		<p class="muted empty">Нет данных для графика.</p>
	{:else}
		<div class="chart-scroll" class:compact bind:this={scrollEl}>
			<svg
				bind:this={svgEl}
				width={layout.width}
				height={layout.height}
				viewBox="0 0 {layout.width} {layout.height}"
				class="chart"
				class:selectable={enableRangeSelect}
				role="img"
				aria-label="График 1ПМ по датам: {title}"
				onpointerdown={onSvgPointerDown}
				onpointermove={onSvgPointerMove}
				onpointerup={onSvgPointerUp}
				onpointercancel={onSvgPointerUp}
			>
				{#if selectionBand}
					<rect
						x={selectionBand.left}
						y={layout.plotTop}
						width={Math.max(selectionBand.right - selectionBand.left, 2)}
						height={layout.plotHeight}
						class="range-band"
						class:draft={selectionBand.draft}
						rx="3"
					/>
				{/if}
				{#each layout.dateTicks as tick, tickIndex (`${tick.x}:${tick.label}:${tickIndex}`)}
					{@const active =
						hoverIndex != null && Math.abs(layout.pointX(hoverIndex) - tick.x) < 0.5}
					<line
						x1={tick.x}
						y1={layout.plotTop}
						x2={tick.x}
						y2={layout.plotBottom}
						class="grid-line"
						class:muted={hoverIndex != null && !active}
					/>
					{#if hoverIndex == null || !active}
						<text x={tick.x} y={layout.height - 6} class="axis-label" text-anchor="middle">{tick.label}</text>
					{/if}
				{/each}

				{#if hoverIndex != null}
					{@const hoverX = layout.pointX(hoverIndex)}
					{@const hoverPoint = sortedPoints[hoverIndex]}
					<line
						x1={hoverX}
						y1={layout.plotTop}
						x2={hoverX}
						y2={layout.plotBottom}
						class="hover-guide"
					/>
					<text x={hoverX} y={layout.height - 6} class="axis-label active" text-anchor="middle">
						{formatDateRu(hoverPoint.date)}
					</text>
				{/if}

				{#each layout.gaps as gap, gapBandIndex (`${gap.startDate}:${gap.endDate}:${gapBandIndex}`)}
					<rect
						x={gap.startX}
						y={layout.plotTop}
						width={Math.max(gap.endX - gap.startX, 3)}
						height={layout.plotHeight}
						class="gap-band"
						class:long={gap.long}
						rx="3"
					/>
					<line
						x1={gap.startX}
						y1={layout.plotTop}
						x2={gap.startX}
						y2={layout.plotBottom}
						class="gap-edge"
						class:long={gap.long}
					/>
					<line
						x1={gap.endX}
						y1={layout.plotTop}
						x2={gap.endX}
						y2={layout.plotBottom}
						class="gap-edge"
						class:long={gap.long}
					/>
					<text
						x={(gap.startX + gap.endX) / 2}
						y={layout.plotTop + layout.plotHeight / 2 + 4}
						class="gap-label"
						class:long={gap.long}
						text-anchor="middle"
					>
						{gap.label}
					</text>
				{/each}

				{#each sortedPoints as point, index (`${point.date}:${point.est1rm}:${index}`)}
					{@const x = layout.pointX(index)}
					{@const y = yScale(point.est1rm, yMin, yMax, layout.plotTop, layout.plotBottom)}
					{#if index > 0}
						{@const prev = sortedPoints[index - 1]}
						{@const gap = Math.round((dateToMs(point.date) - dateToMs(prev.date)) / 86400000)}
						{#if gap <= gapDays}
							{@const px = layout.pointX(index - 1)}
							{@const py = yScale(prev.est1rm, yMin, yMax, layout.plotTop, layout.plotBottom)}
							<line x1={px} y1={py} x2={x} y2={y} stroke={color} stroke-opacity="0.9" stroke-width="2" />
						{/if}
					{/if}
					<g
						class="point-hit"
						class:active={hoverIndex === index}
						class:dimmed={range != null && !pointInRange(point.date)}
						role="presentation"
						onmouseenter={() => showPoint(index)}
						onmouseleave={hidePoint}
						onfocus={() => showPoint(index)}
						onblur={hidePoint}
					>
						<title>{formatDateRu(point.date)} — {fmtNum(point.est1rm)} кг</title>
						<circle cx={x} cy={y} r="10" class="point-target" />
						<circle cx={x} cy={y} r="4" fill={color} class="point-dot" />
					</g>
				{/each}
			</svg>
		</div>

		{#if !compact && layout.width > 640}
			<p class="scroll-hint">Прокрутите график влево‑вправо, чтобы увидеть все {sortedPoints.length} записей</p>
		{/if}

		{#if !compact}
			<ul class="trend-list" bind:this={listEl}>
				{#each displayPoints as point, index (`${point.date}:${point.est1rm}:${index}`)}
					{#if index > 0}
						{@const gap = Math.round(
							(dateToMs(point.date) - dateToMs(displayPoints[index - 1].date)) / 86400000
						)}
						{#if gap > gapDays}
							<li class="gap-row" class:long={gap >= 42}>
								<span>
									перерыв {formatGapLabel(gap)} · {formatDateRu(displayPoints[index - 1].date)} →
									{formatDateRu(point.date)}
								</span>
							</li>
						{/if}
					{/if}
					<li>
						<span>{formatDateRu(point.date)}</span>
						<strong>{fmtNum(point.est1rm)} кг</strong>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>

<style>
	.chart-card {
		padding: 0.85rem;
		border: 1px solid var(--border);
		border-radius: 0;
		background: var(--surface-2);
	}

	.chart-card.compact .chart {
		margin-bottom: 0;
	}

	.chart-head {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		align-items: start;
		margin-bottom: 0.5rem;
	}

	h4 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
	}

	.range-hint {
		margin: 0.2rem 0 0;
		color: var(--muted);
		font-family: var(--font-mono);
		font-size: 0.68rem;
	}

	.chart.selectable {
		cursor: crosshair;
	}

	.range-band {
		fill: color-mix(in srgb, var(--accent, #6ee7a8) 16%, transparent);
		stroke: color-mix(in srgb, var(--accent, #6ee7a8) 45%, transparent);
		stroke-width: 1.5;
		pointer-events: none;
	}

	.range-band.draft {
		fill: color-mix(in srgb, var(--accent, #6ee7a8) 24%, transparent);
		stroke-dasharray: 4 3;
	}

	.point-hit.dimmed .point-dot {
		opacity: 0.28;
	}

	.point-hit.dimmed {
		pointer-events: none;
	}

	.period-caption {
		margin: 0.15rem 0 0;
		color: var(--muted);
		font-family: var(--font-mono);
		font-size: 0.72rem;
	}

	.gap-hint {
		margin: 0.15rem 0 0;
		font-size: 0.78rem;
		color: var(--danger);
	}

	.gap-hint strong {
		color: var(--danger);
	}

	.gap-chips {
		list-style: none;
		margin: 0 0 0.65rem;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.gap-chips.compact {
		margin-bottom: 0.45rem;
	}

	.gap-chip {
		display: grid;
		gap: 0.1rem;
		padding: 0.35rem 0.55rem;
		border-radius: 0;
		border: 1px solid rgba(255, 143, 143, 0.45);
		background: rgba(255, 143, 143, 0.14);
		font-size: 0.75rem;
	}

	.gap-chip.long {
		border-color: rgba(255, 110, 110, 0.65);
		background: rgba(255, 110, 110, 0.22);
	}

	.gap-chip-label {
		color: var(--danger);
		font-weight: 700;
	}

	.gap-chip-dates {
		color: var(--muted);
	}

	.latest {
		color: var(--muted);
		font-size: 0.85rem;
		white-space: nowrap;
	}

	.empty {
		margin: 0;
		font-size: 0.85rem;
	}

	.chart-scroll {
		overflow-x: auto;
		overflow-y: hidden;
		max-width: 100%;
		margin-bottom: 0.35rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 0;
		-webkit-overflow-scrolling: touch;
		direction: rtl;
	}

	.chart-scroll .chart {
		direction: ltr;
	}

	.chart-scroll.compact {
		margin-bottom: 0;
	}

	.scroll-hint {
		margin: 0 0 0.55rem;
		color: var(--muted);
		font-family: var(--font-mono);
		font-size: 0.68rem;
	}

	.chart {
		display: block;
		height: auto;
		margin-bottom: 0;
		background: transparent;
		border: 0;
		border-radius: 0;
	}

	.grid-line {
		stroke: rgba(255, 255, 255, 0.06);
		stroke-width: 1;
	}

	.grid-line.muted {
		stroke-opacity: 0.35;
	}

	.hover-guide {
		stroke: color-mix(in srgb, var(--accent, #6ee7a8) 70%, white);
		stroke-width: 1.5;
		stroke-dasharray: 3 3;
		pointer-events: none;
	}

	.axis-label {
		fill: var(--muted);
		font-size: 10px;
	}

	.axis-label.active {
		fill: var(--text, #f3f4f6);
		font-size: 10px;
		font-weight: 700;
	}

	.point-hit {
		cursor: pointer;
	}

	.point-target {
		fill: transparent;
		stroke: transparent;
	}

	.point-dot {
		pointer-events: none;
	}

	.point-hit.active .point-dot {
		stroke: rgba(255, 255, 255, 0.85);
		stroke-width: 1.5;
	}

	.gap-band {
		fill: rgba(255, 143, 143, 0.2);
		stroke: rgba(255, 143, 143, 0.35);
		stroke-width: 1.5;
	}

	.gap-band.long {
		fill: rgba(255, 110, 110, 0.3);
		stroke: rgba(255, 90, 90, 0.55);
	}

	.gap-edge {
		stroke: rgba(255, 143, 143, 0.7);
		stroke-width: 1.5;
		stroke-dasharray: 4 3;
	}

	.gap-edge.long {
		stroke: rgba(255, 100, 100, 0.9);
		stroke-width: 2;
	}

	.gap-label {
		fill: var(--danger);
		font-size: 11px;
		font-weight: 700;
		paint-order: stroke;
		stroke: rgba(15, 17, 21, 0.85);
		stroke-width: 3px;
	}

	.gap-label.long {
		font-size: 12px;
		fill: #ffb4b4;
	}

	.trend-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.35rem;
		max-height: min(320px, 40vh);
		overflow-y: auto;
	}

	.trend-list li {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.8rem;
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: 0;
		background: var(--surface);
	}

	.gap-row {
		justify-content: center;
		border-style: dashed;
		border-color: rgba(255, 143, 143, 0.5);
		background: rgba(255, 143, 143, 0.12);
		color: var(--danger);
		font-size: 0.75rem;
		font-weight: 600;
	}

	.gap-row.long {
		border-color: rgba(255, 100, 100, 0.65);
		background: rgba(255, 100, 100, 0.18);
	}
</style>
