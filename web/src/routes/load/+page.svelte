<script lang="ts">
	import { base } from '$app/paths';
	import BlockLoadChart from '$lib/components/BlockLoadChart.svelte';
	import {
		buildBlockSummaries,
		buildBlockWeeklyLoad,
		filterWeeksFrom,
		formatMetric,
		metricLabel,
		unmappedStrengthExercises,
		weeksAgoIso,
		type LoadMetric
	} from '$lib/block-load';
	import { fmtNum } from '$lib/format';
	import type { MovementBlockId } from '$lib/muscle-groups';
	import { workoutStore } from '$lib/workout-store';

	type WindowOption = { weeks: number; label: string };

	const windowOptions: WindowOption[] = [
		{ weeks: 4, label: '4 нед.' },
		{ weeks: 8, label: '8 нед.' },
		{ weeks: 12, label: '12 нед.' },
		{ weeks: 0, label: 'Всё время' }
	];

	let windowWeeks = $state(8);
	let metric = $state<LoadMetric>('tonnage');
	let selectedBlock = $state<MovementBlockId | null>(null);

	const view = $derived(workoutStore.view);
	const allWeeks = $derived(buildBlockWeeklyLoad(view.entries));
	const fromDate = $derived(windowWeeks > 0 ? weeksAgoIso(windowWeeks) : null);
	const visibleWeeks = $derived(filterWeeksFrom(allWeeks, fromDate));
	const summaries = $derived(buildBlockSummaries(allWeeks, windowWeeks || allWeeks.length, 4));
	const blockIds = $derived(summaries.map((item) => item.block.id));
	const selectedSummary = $derived(
		selectedBlock ? (summaries.find((item) => item.block.id === selectedBlock) ?? null) : null
	);
	const unmapped = $derived(unmappedStrengthExercises(view.entries));

	const parallelTotal = $derived(
		summaries.reduce(
			(sum, item) =>
				sum + (metric === 'tonnage' ? item.totals.tonnage : metric === 'reps' ? item.totals.reps : item.totals.sets),
			0
		)
	);

	function trendLabel(value: number | null): string {
		if (value == null) return '—';
		if (value > 0) return `+${fmtNum(value)}%`;
		return `${fmtNum(value)}%`;
	}

	function toggleBlock(id: MovementBlockId) {
		selectedBlock = selectedBlock === id ? null : id;
	}
</script>

<div class="container">
	<header class="page-header">
		<div>
			<div class="eyebrow">Распределение объёма</div>
			<h1>Нагрузка по блокам</h1>
			<p>
				Коленодоминантные, тазодоминантные, тяги и жимы — параллельная нагрузка и динамика
				по неделям.
			</p>
		</div>
		<a class="button button-secondary" href="{base}/body">Карта тела</a>
	</header>

	<section class="controls card">
		<div class="control-group">
			<span class="control-label">Период</span>
			<div class="pill-row">
				{#each windowOptions as option}
					<button
						type="button"
						class="pill"
						class:active={windowWeeks === option.weeks}
						onclick={() => (windowWeeks = option.weeks)}
					>
						{option.label}
					</button>
				{/each}
			</div>
		</div>
		<div class="control-group">
			<span class="control-label">Метрика</span>
			<div class="pill-row">
				{#each ['tonnage', 'reps', 'sets'] as key}
					<button
						type="button"
						class="pill"
						class:active={metric === key}
						onclick={() => (metric = key as LoadMetric)}
					>
						{metricLabel(key as LoadMetric)}
					</button>
				{/each}
			</div>
		</div>
	</section>

	{#if summaries.length === 0}
		<section class="card empty-state">
			<h2>Пока нет силовых записей с блоками</h2>
			<p>Запишите тренировки — здесь появится распределение нагрузки по паттернам движения.</p>
			<a class="button button-primary" href="{base}/add">Записать тренировку</a>
		</section>
	{:else}
		<section class="card parallel-panel">
			<div class="panel-head">
				<div>
					<h2>Параллельная нагрузка</h2>
					<p>Доля {metricLabel(metric).toLowerCase()} по блокам за выбранный период</p>
				</div>
				<strong class="parallel-total">{formatMetric(parallelTotal, metric)}</strong>
			</div>

			<div class="parallel-bar" role="img" aria-label="Распределение нагрузки по блокам">
				{#each summaries as item (item.block.id)}
					{@const value =
						metric === 'tonnage'
							? item.totals.tonnage
							: metric === 'reps'
								? item.totals.reps
								: item.totals.sets}
					{@const share = parallelTotal ? (value / parallelTotal) * 100 : 0}
					{#if share > 0}
						<button
							type="button"
							class="parallel-segment"
							class:active={selectedBlock === item.block.id}
							style={`width: ${share}%; --block-color: ${item.block.color}`}
							title="{item.block.label}: {formatMetric(value, metric)}"
							onclick={() => toggleBlock(item.block.id)}
						>
							{#if share >= 8}
								<span>{item.block.shortLabel}</span>
							{/if}
						</button>
					{/if}
				{/each}
			</div>

			<div class="legend-grid">
				{#each summaries as item (item.block.id)}
					{@const trend = metric === 'tonnage' ? item.trendTonnage : item.trendReps}
					<button
						type="button"
						class="legend-card"
						class:active={selectedBlock === item.block.id}
						style={`--block-color: ${item.block.color}`}
						onclick={() => toggleBlock(item.block.id)}
					>
						<span class="legend-swatch"></span>
						<div class="legend-copy">
							<strong>{item.block.label}</strong>
							<span>
								{formatMetric(
									metric === 'tonnage'
										? item.totals.tonnage
										: metric === 'reps'
											? item.totals.reps
											: item.totals.sets,
									metric
								)}
								· {metric === 'tonnage' ? item.shareTonnage : item.shareReps}%
							</span>
						</div>
						<div class="legend-trend">
							<span class:up={(trend ?? 0) > 0} class:down={(trend ?? 0) < 0}>
								{trendLabel(trend)}
							</span>
							<small>к прошл. периоду</small>
						</div>
					</button>
				{/each}
			</div>
		</section>

		<section class="card chart-panel">
			<div class="panel-head">
				<div>
					<h2>Динамика по неделям</h2>
					<p>Столбец = сумма {metricLabel(metric).toLowerCase()} за неделю, цвета = блоки одновременно</p>
				</div>
			</div>
			<BlockLoadChart weeks={visibleWeeks} {blockIds} {metric} />
		</section>

		{#if selectedSummary}
			<section class="card detail-panel" style={`--block-color: ${selectedSummary.block.color}`}>
				<div class="panel-head">
					<div>
						<p class="detail-kicker">Выбранный блок</p>
						<h2>{selectedSummary.block.label}</h2>
						<p>{selectedSummary.block.description}</p>
					</div>
					<button type="button" class="button button-ghost" onclick={() => (selectedBlock = null)}>
						Закрыть
					</button>
				</div>

				<div class="detail-metrics">
					<article>
						<span>Тоннаж</span>
						<strong>{formatMetric(selectedSummary.totals.tonnage, 'tonnage')}</strong>
					</article>
					<article>
						<span>Повторы</span>
						<strong>{formatMetric(selectedSummary.totals.reps, 'reps')}</strong>
					</article>
					<article>
						<span>Подходы</span>
						<strong>{formatMetric(selectedSummary.totals.sets, 'sets')}</strong>
					</article>
					<article>
						<span>Тренировок</span>
						<strong>{selectedSummary.totals.sessions}</strong>
					</article>
				</div>

				<div class="mini-bars">
					{#each selectedSummary.weekly as week (week.weekStart)}
						{@const value =
							metric === 'tonnage' ? week.tonnage : metric === 'reps' ? week.reps : week.sets}
						{@const max = Math.max(...selectedSummary.weekly.map((row) =>
							metric === 'tonnage' ? row.tonnage : metric === 'reps' ? row.reps : row.sets
						), 1)}
						<div class="mini-bar" title="{week.weekStart}: {formatMetric(value, metric)}">
							<div class="mini-fill" style={`height: ${(value / max) * 100}%`}></div>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		{#if unmapped.length > 0}
			<section class="card unmapped">
				<h3>Без блока</h3>
				<p>Эти упражнения не попали в классификацию — нагрузка по ним здесь не учитывается:</p>
				<ul>
					{#each unmapped as exercise}
						<li>{exercise}</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}
</div>

<style>
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 18px 28px;
		padding: 16px 18px;
		margin-bottom: 14px;
	}

	.control-group {
		display: grid;
		gap: 8px;
	}

	.control-label {
		color: var(--muted);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.pill-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.pill {
		padding: 7px 12px;
		color: var(--muted-strong);
		background: #0a0c10;
		border: 1px solid var(--line);
		cursor: pointer;
		font-size: 11px;
		font-weight: 700;
	}

	.pill.active {
		color: var(--accent-ink);
		background: var(--accent);
		border-color: var(--accent);
	}

	.panel-head {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		align-items: flex-start;
		margin-bottom: 16px;
	}

	.panel-head h2 {
		margin: 0 0 4px;
		font-size: 18px;
	}

	.panel-head p {
		margin: 0;
		color: var(--muted);
		font-size: 12px;
	}

	.parallel-panel,
	.chart-panel,
	.detail-panel {
		padding: 20px;
		margin-bottom: 14px;
	}

	.parallel-total {
		color: var(--accent);
		font-family: var(--font-mono);
		font-size: 18px;
		white-space: nowrap;
	}

	.parallel-bar {
		display: flex;
		height: 34px;
		overflow: hidden;
		border: 1px solid var(--line-strong);
		background: #0a0c10;
	}

	.parallel-segment {
		display: grid;
		min-width: 2px;
		place-items: center;
		padding: 0;
		background: var(--block-color);
		border: 0;
		border-right: 1px solid rgb(0 0 0 / 35%);
		color: #0b0c0f;
		cursor: pointer;
		font-size: 9px;
		font-weight: 800;
		transition: filter 120ms ease;
	}

	.parallel-segment:hover,
	.parallel-segment.active {
		filter: brightness(1.12);
	}

	.legend-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 8px;
		margin-top: 14px;
	}

	.legend-card {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 10px;
		align-items: center;
		padding: 10px 12px;
		text-align: left;
		background: #0a0c10;
		border: 1px solid var(--line);
		cursor: pointer;
		color: var(--text);
	}

	.legend-card.active {
		border-color: color-mix(in srgb, var(--block-color) 55%, var(--line));
		background: color-mix(in srgb, var(--block-color) 8%, #0a0c10);
	}

	.legend-swatch {
		width: 10px;
		height: 28px;
		background: var(--block-color);
	}

	.legend-copy strong {
		display: block;
		font-size: 12px;
	}

	.legend-copy span {
		color: var(--muted);
		font-family: var(--font-mono);
		font-size: 10px;
	}

	.legend-trend {
		text-align: right;
	}

	.legend-trend span {
		display: block;
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 700;
	}

	.legend-trend span.up {
		color: var(--accent);
	}

	.legend-trend span.down {
		color: var(--danger);
	}

	.legend-trend small {
		color: var(--muted);
		font-size: 9px;
	}

	.detail-panel {
		border-color: color-mix(in srgb, var(--block-color) 35%, var(--line));
	}

	.detail-kicker {
		margin: 0 0 4px;
		color: var(--block-color);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.detail-metrics {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 10px;
		margin-bottom: 18px;
	}

	.detail-metrics article {
		padding: 12px;
		background: var(--surface-soft);
		border: 1px solid var(--line);
	}

	.detail-metrics span {
		display: block;
		color: var(--muted);
		font-size: 9px;
	}

	.detail-metrics strong {
		display: block;
		margin-top: 6px;
		font-family: var(--font-mono);
		font-size: 14px;
	}

	.mini-bars {
		display: flex;
		align-items: flex-end;
		gap: 6px;
		height: 88px;
		padding-top: 8px;
		border-top: 1px solid var(--line);
	}

	.mini-bar {
		flex: 1;
		display: flex;
		align-items: flex-end;
		height: 100%;
		background: rgb(255 255 255 / 2%);
		border: 1px solid var(--line);
	}

	.mini-fill {
		width: 100%;
		background: color-mix(in srgb, var(--block-color) 75%, transparent);
	}

	.unmapped {
		padding: 18px 20px;
	}

	.unmapped h3 {
		margin: 0 0 6px;
		font-size: 16px;
	}

	.unmapped p {
		margin: 0;
		color: var(--muted);
		font-size: 12px;
	}

	.unmapped ul {
		margin: 10px 0 0;
		padding-left: 18px;
		color: var(--muted-strong);
		font-size: 12px;
	}

	.empty-state {
		padding: 28px;
		text-align: center;
	}

	.empty-state h2 {
		margin: 0 0 8px;
	}

	.empty-state p {
		margin: 0 0 16px;
		color: var(--muted);
	}

	@media (max-width: 720px) {
		.detail-metrics {
			grid-template-columns: 1fr 1fr;
		}

		.panel-head {
			flex-direction: column;
		}
	}
</style>
