<script lang="ts">
	import { formatDateRu } from '$lib/format';
	import {
		formatMetric,
		type BlockLoadWeek,
		type LoadMetric
	} from '$lib/block-load';
	import { MOVEMENT_BLOCKS, type MovementBlockId } from '$lib/muscle-groups';

	type StackSegment = {
		id: MovementBlockId;
		x: number;
		y: number;
		width: number;
		height: number;
		value: number;
		color: string;
		label: string;
		weekStart: string;
	};

	let {
		weeks,
		blockIds,
		metric = 'tonnage',
		height = 220
	}: {
		weeks: BlockLoadWeek[];
		blockIds: MovementBlockId[];
		metric?: LoadMetric;
		height?: number;
	} = $props();

	const width = 640;
	const padding = { left: 48, right: 12, top: 14, bottom: 32 };
	const plotWidth = width - padding.left - padding.right;
	const plotHeight = $derived(height - padding.top - padding.bottom);
	const plotBottom = $derived(padding.top + plotHeight);

	const blockMeta = $derived(
		new Map(MOVEMENT_BLOCKS.filter((block) => blockIds.includes(block.id)).map((block) => [block.id, block]))
	);

	function blockValue(week: BlockLoadWeek, id: MovementBlockId): number {
		const row = week.blocks[id];
		if (!row) return 0;
		return metric === 'tonnage' ? row.tonnage : metric === 'reps' ? row.reps : row.sets;
	}

	const maxTotal = $derived(
		weeks.length
			? Math.max(...weeks.map((week) => blockIds.reduce((sum, id) => sum + blockValue(week, id), 0)), 1)
			: 1
	);

	const barWidth = $derived(weeks.length ? Math.min(42, Math.max(12, plotWidth / weeks.length - 8)) : 24);

	const segments = $derived.by(() => {
		const items: StackSegment[] = [];
		const labels: { x: number; weekStart: string }[] = [];

		weeks.forEach((week, index) => {
			const total = blockIds.reduce((sum, id) => sum + blockValue(week, id), 0);
			const barHeight = (total / maxTotal) * plotHeight;
			const x = barX(index);
			let y = plotBottom - barHeight;

			for (const id of blockIds) {
				const value = blockValue(week, id);
				if (!value || !total) continue;
				const segmentHeight = (value / total) * barHeight;
				const meta = blockMeta.get(id);
				items.push({
					id,
					x: x - barWidth / 2,
					y,
					width: barWidth,
					height: segmentHeight,
					value,
					color: meta?.color ?? '#666',
					label: meta?.label ?? id,
					weekStart: week.weekStart
				});
				y += segmentHeight;
			}

			labels.push({ x, weekStart: week.weekStart });
		});

		return { items, labels };
	});

	function barX(index: number): number {
		if (weeks.length <= 1) return padding.left + plotWidth / 2;
		const gap = plotWidth / weeks.length;
		return padding.left + gap * index + gap / 2;
	}

	function weekLabel(iso: string): string {
		const [, m, d] = iso.split('-');
		return `${d}.${m}`;
	}
</script>

{#if weeks.length === 0}
	<p class="empty">Нет данных за выбранный период.</p>
{:else}
	<svg
		viewBox="0 0 {width} {height}"
		class="chart"
		role="img"
		aria-label="Недельная нагрузка по блокам"
	>
		{#each [0, 0.25, 0.5, 0.75, 1] as tick}
			{@const y = padding.top + plotHeight * (1 - tick)}
			<line x1={padding.left} y1={y} x2={width - padding.right} y2={y} class="grid" />
			<text x={padding.left - 8} y={y + 4} text-anchor="end" class="axis">
				{Math.round(maxTotal * tick)}
			</text>
		{/each}

		{#each segments.items as segment (`${segment.weekStart}-${segment.id}`)}
			<rect
				x={segment.x}
				y={segment.y}
				width={segment.width}
				height={segment.height}
				fill={segment.color}
				class="bar-segment"
			>
				<title>
					{segment.label}: {formatMetric(segment.value, metric)} · {formatDateRu(segment.weekStart)}
				</title>
			</rect>
		{/each}

		{#each segments.labels as label (label.weekStart)}
			<text x={label.x} y={plotBottom + 18} text-anchor="middle" class="tick">
				{weekLabel(label.weekStart)}
			</text>
		{/each}
	</svg>
{/if}

<style>
	.chart {
		display: block;
		width: 100%;
		height: auto;
	}

	.grid {
		stroke: var(--line);
		stroke-width: 1;
	}

	.axis,
	.tick {
		fill: var(--muted);
		font-family: var(--font-mono);
		font-size: 9px;
	}

	.bar-segment {
		stroke: rgb(0 0 0 / 28%);
		stroke-width: 0.5;
	}

	.empty {
		margin: 0;
		padding: 2rem 0;
		color: var(--muted);
		text-align: center;
		font-size: 12px;
	}
</style>
