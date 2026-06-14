<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { base } from '$app/paths';
	import BlockLoadChart from '$lib/components/BlockLoadChart.svelte';
	import {
		blockExerciseNames,
		buildBlockSummaries,
		buildBlockWeeklyLoad,
		buildLoadInsights,
		filterWeeksFrom,
		formatMetric,
		metricDefinition,
		metricLabel,
		metricLabelGenitive,
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
	const insights = $derived(buildLoadInsights(summaries, metric));
	const selectedExercises = $derived(
		selectedBlock ? blockExerciseNames(view.entries, selectedBlock) : []
	);

	let detailEl = $state<HTMLElement | null>(null);

	const PREFS_KEY = 'gym:load:prefs';
	let prefsLoaded = $state(false);

	onMount(() => {
		try {
			const raw = localStorage.getItem(PREFS_KEY);
			if (raw) {
				const saved = JSON.parse(raw) as { windowWeeks?: number; metric?: LoadMetric };
				if (typeof saved.windowWeeks === 'number') windowWeeks = saved.windowWeeks;
				if (saved.metric === 'tonnage' || saved.metric === 'reps' || saved.metric === 'sets') {
					metric = saved.metric;
				}
			}
		} catch {
			// ignore corrupt prefs
		}
		prefsLoaded = true;
	});

	$effect(() => {
		const payload = JSON.stringify({ windowWeeks, metric });
		if (!prefsLoaded) return;
		try {
			localStorage.setItem(PREFS_KEY, payload);
		} catch {
			// storage unavailable
		}
	});

	const periodLabel = $derived(windowWeeks > 0 ? `за ${windowWeeks} нед.` : 'за всё время');

	function shortDate(iso: string): string {
		const [, m, d] = iso.split('-');
		return `${d}.${m}`;
	}

	const rangeLabel = $derived(
		visibleWeeks.length
			? `${shortDate(visibleWeeks[0].weekStart)} – ${shortDate(visibleWeeks[visibleWeeks.length - 1].weekStart)}`
			: ''
	);

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

	async function toggleBlock(id: MovementBlockId) {
		const opening = selectedBlock !== id;
		selectedBlock = opening ? id : null;
		if (opening) {
			await tick();
			detailEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	}
</script>

<div class="container">
	<header class="page-header">
		<div>
			<div class="eyebrow">Распределение объёма</div>
			<h1>Нагрузка по блокам</h1>
			<p>
				Сколько работы пришлось на каждый паттерн движения и как нагрузка менялась
				по неделям.
			</p>
		</div>
		<a class="button button-secondary" href="{base}/body">Карта тела</a>
	</header>

	<section class="controls card">
		<div class="control-group">
			<span class="control-label">Период</span>
			<div class="pill-row">
				{#each windowOptions as option (option.weeks)}
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
			{#if rangeLabel}
				<span class="control-hint">{rangeLabel}</span>
			{/if}
		</div>
		<div class="control-group">
			<span class="control-label">Метрика</span>
			<div class="pill-row">
				{#each ['tonnage', 'reps', 'sets'] as key (key)}
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
			<span class="control-hint">{metricDefinition(metric)}</span>
		</div>
	</section>

	{#if !workoutStore.bootstrapped}
		<section class="card skeleton-panel" aria-busy="true" aria-label="Загрузка данных">
			<div class="skeleton-head">
				<span class="skeleton skeleton-title"></span>
				<span class="skeleton skeleton-total"></span>
			</div>
			<span class="skeleton skeleton-bar"></span>
			<div class="skeleton-grid">
				{#each Array.from({ length: 6 }) as _, i (i)}
					<span class="skeleton skeleton-card"></span>
				{/each}
			</div>
			<span class="skeleton skeleton-chart"></span>
		</section>
	{:else if summaries.length === 0 && unmapped.length > 0}
		<section class="card empty-state">
			<h2>Записи есть, но не привязаны к блокам</h2>
			<p>
				Эти упражнения не попали в классификацию паттернов движения, поэтому нагрузка по ним
				не считается. Привяжите их к блокам — и здесь появится распределение.
			</p>
			<ul class="empty-unmapped">
				{#each unmapped as exercise}
					<li>{exercise}</li>
				{/each}
			</ul>
			<a class="button button-primary" href="{base}/exercises">Настроить упражнения</a>
		</section>
	{:else if summaries.length === 0}
		<section class="card empty-state">
			<h2>Пока нет силовых записей</h2>
			<p>
				Здесь появится распределение нагрузки по паттернам движения, как только вы запишете
				силовые тренировки.
			</p>
			<a class="button button-primary" href="{base}/add">Записать тренировку</a>
		</section>
	{:else}
		{#if insights.length > 0}
			<section class="card insights">
				<div class="panel-head">
					<div>
						<h2>Выводы</h2>
						<p>Автоматическая интерпретация по {metricLabelGenitive(metric)} {periodLabel}</p>
					</div>
				</div>
				<ul class="insight-list">
					{#each insights as item (item.id)}
						<li class="insight insight-{item.tone}">
							<span class="insight-dot"></span>
							<div>
								<strong>{item.title}</strong>
								<p>{item.detail}</p>
							</div>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section class="card parallel-panel">
			<div class="panel-head">
				<div>
					<h2>Состав нагрузки</h2>
					<p>Доля {metricLabelGenitive(metric)} по блокам {periodLabel}</p>
				</div>
				<div class="parallel-total-wrap">
					<span class="parallel-total-caption">Всего {periodLabel}</span>
					<strong class="parallel-total">{formatMetric(parallelTotal, metric)}</strong>
				</div>
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
							style:--block-color={item.block.color}
							style:width="{share}%"
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
					{@const trend =
						metric === 'tonnage'
							? item.trendTonnage
							: metric === 'reps'
								? item.trendReps
								: item.trendSets}
					{@const share =
						metric === 'tonnage'
							? item.shareTonnage
							: metric === 'reps'
								? item.shareReps
								: item.shareSets}
					<button
						type="button"
						class="legend-card"
						class:active={selectedBlock === item.block.id}
						style:--block-color={item.block.color}
						style:--share="{share}%"
						onclick={() => toggleBlock(item.block.id)}
					>
						<span class="legend-fill"></span>
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
								· {metric === 'tonnage'
									? item.shareTonnage
									: metric === 'reps'
										? item.shareReps
										: item.shareSets}%
							</span>
						</div>
						<div class="legend-trend" title="Последние 4 недели против предыдущих 4 недель">
							<span class:up={(trend ?? 0) > 0} class:down={(trend ?? 0) < 0}>
								{trendLabel(trend)}
							</span>
							<small>посл. 4 нед. к пред. 4</small>
						</div>
					</button>
				{/each}
			</div>
		</section>

		<section class="card chart-panel">
			<div class="panel-head">
				<div>
					<h2>Динамика по неделям</h2>
					<p>Столбец = сумма {metricLabelGenitive(metric)} за неделю, цвета = блоки одновременно</p>
				</div>
			</div>
			<BlockLoadChart weeks={visibleWeeks} {blockIds} {metric} />

			<div class="chart-legend">
				{#each summaries as item (item.block.id)}
					<span class="chart-legend-item">
						<span class="chart-legend-swatch" style:background={item.block.color}></span>
						{item.block.label}
					</span>
				{/each}
			</div>
		</section>

		{#if selectedSummary}
			<section
				bind:this={detailEl}
				class="card detail-panel"
				style:--block-color={selectedSummary.block.color}
			>
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

				<p class="detail-section-label">Динамика блока по неделям ({metricLabel(metric)})</p>
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

				{#if selectedExercises.length > 0}
					<p class="detail-section-label">Что входит в блок</p>
					<ul class="detail-exercises">
						{#each selectedExercises as exercise (exercise)}
							<li>{exercise}</li>
						{/each}
					</ul>
				{/if}

				<div class="detail-actions">
					<a class="button button-secondary" href="{base}/exercises">Открыть упражнения</a>
					<a class="button button-secondary" href="{base}/cycles">Посмотреть в плане</a>
					<a class="button button-secondary" href="{base}/body">Карта тела</a>
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

		<section class="card next-steps">
			<h3>Что дальше</h3>
			<div class="next-steps-row">
				<a class="button button-secondary" href="{base}/add">Записать тренировку</a>
				<a class="button button-secondary" href="{base}/history">Открыть журнал</a>
				<a class="button button-secondary" href="{base}/cycles">Перейти к плану</a>
				<a class="button button-secondary" href="{base}/stats">Аналитика</a>
			</div>
		</section>
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

	.control-hint {
		display: block;
		max-width: 360px;
		color: var(--muted);
		font-size: 11px;
		line-height: 1.35;
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

	.parallel-total-wrap {
		display: grid;
		justify-items: end;
		gap: 2px;
		text-align: right;
	}

	.parallel-total-caption {
		color: var(--muted);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		white-space: nowrap;
	}

	.parallel-total {
		color: var(--accent);
		font-family: var(--font-mono);
		font-size: 18px;
		white-space: nowrap;
	}

	.chart-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 14px;
		margin-top: 14px;
		padding-top: 12px;
		border-top: 1px solid var(--line);
	}

	.chart-legend-item {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--muted-strong);
		font-size: 11px;
	}

	.chart-legend-swatch {
		width: 10px;
		height: 10px;
		border-radius: 2px;
	}

	.empty-unmapped {
		margin: 0 auto 16px;
		padding: 0;
		max-width: 360px;
		text-align: left;
		color: var(--muted-strong);
		font-size: 12px;
		list-style-position: inside;
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
		position: relative;
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
		overflow: hidden;
	}

	.legend-fill {
		position: absolute;
		left: 0;
		bottom: 0;
		width: var(--share, 0%);
		height: 3px;
		background: var(--block-color);
		opacity: 0.85;
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

	.insights {
		padding: 20px;
		margin-bottom: 14px;
	}

	.insight-list {
		display: grid;
		gap: 10px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.insight {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 10px;
		align-items: start;
		padding: 10px 12px;
		background: #0a0c10;
		border: 1px solid var(--line);
		border-left: 3px solid var(--muted);
	}

	.insight-warn {
		border-left-color: var(--danger);
	}

	.insight-ok {
		border-left-color: var(--accent);
	}

	.insight-info {
		border-left-color: var(--muted-strong);
	}

	.insight-dot {
		width: 8px;
		height: 8px;
		margin-top: 6px;
		border-radius: 50%;
		background: var(--muted);
	}

	.insight-warn .insight-dot {
		background: var(--danger);
	}

	.insight-ok .insight-dot {
		background: var(--accent);
	}

	.insight-info .insight-dot {
		background: var(--muted-strong);
	}

	.insight strong {
		display: block;
		font-size: 13px;
	}

	.insight p {
		margin: 2px 0 0;
		color: var(--muted);
		font-size: 12px;
		line-height: 1.4;
	}

	.detail-section-label {
		margin: 18px 0 8px;
		color: var(--muted);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.detail-exercises {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.detail-exercises li {
		padding: 5px 10px;
		background: var(--surface-soft);
		border: 1px solid var(--line);
		color: var(--muted-strong);
		font-size: 11px;
	}

	.detail-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 18px;
		padding-top: 16px;
		border-top: 1px solid var(--line);
	}

	.next-steps {
		padding: 18px 20px;
		margin-bottom: 14px;
	}

	.next-steps h3 {
		margin: 0 0 12px;
		font-size: 14px;
	}

	.next-steps-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.skeleton-panel {
		padding: 20px;
		margin-bottom: 14px;
	}

	.skeleton-head {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 16px;
	}

	.skeleton {
		display: block;
		background: linear-gradient(90deg, #0c0f14 25%, #161a22 37%, #0c0f14 63%);
		background-size: 400% 100%;
		animation: skeleton-shimmer 1.4s ease infinite;
		border-radius: 2px;
	}

	.skeleton-title {
		width: 180px;
		height: 20px;
	}

	.skeleton-total {
		width: 70px;
		height: 20px;
	}

	.skeleton-bar {
		width: 100%;
		height: 34px;
		margin-bottom: 14px;
	}

	.skeleton-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 8px;
		margin-bottom: 18px;
	}

	.skeleton-card {
		height: 52px;
	}

	.skeleton-chart {
		width: 100%;
		height: 200px;
	}

	@keyframes skeleton-shimmer {
		0% {
			background-position: 100% 50%;
		}

		100% {
			background-position: 0 50%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton {
			animation: none;
		}
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

		.parallel-total-wrap {
			justify-items: start;
			text-align: left;
		}

		.parallel-bar {
			height: 44px;
		}

		.detail-actions .button,
		.next-steps-row .button {
			flex: 1 1 140px;
			text-align: center;
		}
	}

	@media (max-width: 480px) {
		.parallel-segment span {
			display: none;
		}
	}
</style>
