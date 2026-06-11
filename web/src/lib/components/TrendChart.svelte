<script lang="ts">
	import { fmtNum, formatDateRu } from '$lib/format';
	import type { TrendPoint } from '$lib/types';

	let {
		title,
		points,
		color = '#6ee7a8',
		compact = false
	}: {
		title: string;
		points: TrendPoint[];
		color?: string;
		compact?: boolean;
	} = $props();

	const max = $derived(points.length ? Math.max(...points.map((p) => p.est1rm)) : 0);
	const min = $derived(points.length ? Math.min(...points.map((p) => p.est1rm)) : 0);
	const span = $derived(Math.max(max - min, 1));
</script>

<div class="chart-card" class:compact>
	<div class="chart-head">
		<h4>{title}</h4>
		{#if points.length > 0}
			<span class="latest">{fmtNum(points[points.length - 1].est1rm)} кг</span>
		{/if}
	</div>

	{#if points.length === 0}
		<p class="muted empty">Нет данных для графика.</p>
	{:else}
		<svg viewBox="0 0 640 180" class="chart" role="img" aria-label="График 1ПМ: {title}">
			{#each points as point, index}
				{@const x = 40 + (index / Math.max(points.length - 1, 1)) * 560}
				{@const y = 150 - ((point.est1rm - min) / span) * 110}
				{#if index > 0}
					{@const prev = points[index - 1]}
					{@const px = 40 + ((index - 1) / Math.max(points.length - 1, 1)) * 560}
					{@const py = 150 - ((prev.est1rm - min) / span) * 110}
					<line x1={px} y1={py} x2={x} y2={y} stroke={color} stroke-opacity="0.85" stroke-width="2" />
				{/if}
				<circle cx={x} cy={y} r="4" fill={color} />
			{/each}
		</svg>

		{#if !compact}
			<ul class="trend-list">
				{#each points.slice(-6) as point}
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
		align-items: baseline;
		margin-bottom: 0.5rem;
	}

	h4 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
	}

	.latest {
		color: var(--muted);
		font-size: 0.85rem;
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
	}

	.trend-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
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
</style>
