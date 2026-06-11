<script lang="ts">
	import {
		TRAINING_GAP_DAYS,
		buildTimeChartLayout,
		dateToMs,
		formatGapLabel,
		yScale
	} from '$lib/chart-time';
	import { fmtNum, formatDateRu } from '$lib/format';
	import type { TrendPoint } from '$lib/types';

	let {
		title,
		points,
		color = '#6ee7a8',
		compact = false,
		gapDays = TRAINING_GAP_DAYS
	}: {
		title: string;
		points: TrendPoint[];
		color?: string;
		compact?: boolean;
		gapDays?: number;
	} = $props();

	const layout = $derived(
		buildTimeChartLayout(points, {
			height: compact ? 168 : 230,
			gapDays,
			maxTicks: compact ? 4 : 6
		})
	);

	const sortedPoints = $derived([...points].sort((a, b) => a.date.localeCompare(b.date)));

	const yMin = $derived(sortedPoints.length ? Math.min(...sortedPoints.map((p) => p.est1rm)) : 0);
	const yMax = $derived(sortedPoints.length ? Math.max(...sortedPoints.map((p) => p.est1rm)) : 0);
</script>

<div class="chart-card" class:compact>
	<div class="chart-head">
		<div>
			<h4>{title}</h4>
			{#if layout && layout.gaps.length > 0}
				<p class="gap-hint">
					Перерывы &gt; 3 нед.: <strong>{layout.gaps.length}</strong>
				</p>
			{/if}
		</div>
		{#if sortedPoints.length > 0}
			<span class="latest">{fmtNum(sortedPoints[sortedPoints.length - 1].est1rm)} кг</span>
		{/if}
	</div>

	{#if layout && layout.gaps.length > 0}
		<ul class="gap-chips" class:compact>
			{#each layout.gaps as gap (gap.startDate + gap.endDate)}
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
		<svg
			viewBox="0 0 {layout.width} {layout.height}"
			class="chart"
			role="img"
			aria-label="График 1ПМ по датам: {title}"
		>
			{#each layout.dateTicks as tick (tick.date)}
				<line
					x1={tick.x}
					y1={layout.plotTop}
					x2={tick.x}
					y2={layout.plotBottom}
					class="grid-line"
				/>
				<text x={tick.x} y={layout.height - 6} class="axis-label" text-anchor="middle">{tick.label}</text>
			{/each}

			{#each layout.gaps as gap (gap.startDate + gap.endDate)}
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

			{#each layout.segments as segment}
				{#each segment as point, index}
					{@const x = layout.xScale(point.date)}
					{@const y = yScale(point.est1rm, yMin, yMax, layout.plotTop, layout.plotBottom)}
					{#if index > 0}
						{@const prev = segment[index - 1]}
						{@const px = layout.xScale(prev.date)}
						{@const py = yScale(prev.est1rm, yMin, yMax, layout.plotTop, layout.plotBottom)}
						<line x1={px} y1={py} x2={x} y2={y} stroke={color} stroke-opacity="0.9" stroke-width="2" />
					{/if}
					<circle cx={x} cy={y} r="4" fill={color} />
					<title>{formatDateRu(point.date)} — {fmtNum(point.est1rm)} кг</title>
				{/each}
			{/each}
		</svg>

		{#if !compact}
			<ul class="trend-list">
				{#each sortedPoints as point, index (point.date)}
					{#if index > 0}
						{@const gap = Math.round(
							(dateToMs(point.date) - dateToMs(sortedPoints[index - 1].date)) / 86400000
						)}
						{#if gap > gapDays}
							<li class="gap-row" class:long={gap >= 42}>
								<span>
									перерыв {formatGapLabel(gap)} · {formatDateRu(sortedPoints[index - 1].date)} →
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
		border-radius: 12px;
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
		border-radius: 8px;
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

	.chart {
		width: 100%;
		height: auto;
		display: block;
		margin-bottom: 0.65rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
	}

	.grid-line {
		stroke: rgba(255, 255, 255, 0.06);
		stroke-width: 1;
	}

	.axis-label {
		fill: var(--muted);
		font-size: 10px;
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
	}

	.trend-list li {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.8rem;
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: 8px;
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
