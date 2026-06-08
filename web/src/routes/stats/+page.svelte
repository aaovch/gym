<script lang="ts">
	import { fmtNum, fmtSet, formatDateRu } from '$lib/format';
	import { workoutView } from '$lib/workout-store';
	import type { StrengthSummary, TrendPoint } from '$lib/types';

	let query = $state('');
	let selectedExercise = $state<string | null>(null);

	const strengthSummary = $derived(
		$workoutView.summary.filter((item): item is StrengthSummary => item.kind === 'strength')
	);

	const filtered = $derived(
		strengthSummary.filter((item) => item.exercise.toLowerCase().includes(query.trim().toLowerCase()))
	);

	const trendPoints = $derived<TrendPoint[]>(
		selectedExercise ? ($workoutView.trend[selectedExercise] ?? []) : []
	);

	function selectExercise(name: string) {
		selectedExercise = selectedExercise === name ? null : name;
	}
</script>

<section class="card">
	<div class="toolbar">
		<div>
			<h2>Статистика по упражнениям</h2>
			<p class="muted">Считается автоматически из JSON-базы.</p>
		</div>
		<input class="search" type="search" placeholder="Фильтр..." bind:value={query} />
	</div>

	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Упражнение</th>
					<th>Сессий</th>
					<th>1ПМ (Эпли)</th>
					<th>Лучший сет</th>
					<th>~5RM</th>
					<th>Период</th>
				</tr>
			</thead>
			<tbody>
				{#each filtered as item}
					<tr class:selected={selectedExercise === item.exercise}>
						<td data-label="Упражнение">
							<button class="linkish" onclick={() => selectExercise(item.exercise)}>
								{item.exercise}
							</button>
						</td>
						<td data-label="Сессий">{item.sessions}</td>
						<td data-label="1ПМ (Эпли)">
							{#if item.best1rm.date}
								<strong>{fmtNum(item.best1rm.value)} кг</strong>
								<div class="sub">
									{fmtSet(item.best1rm.weight, item.best1rm.reps)} · {formatDateRu(item.best1rm.date)}
								</div>
							{:else}
								—
							{/if}
						</td>
						<td data-label="Лучший сет">
							{#if item.bestWeight.date}
								{fmtSet(item.bestWeight.weight, item.bestWeight.reps)}
								<div class="sub">{formatDateRu(item.bestWeight.date)}</div>
							{:else}
								—
							{/if}
						</td>
						<td data-label="~5RM">
							{#if item.best5}
								{fmtSet(item.best5.weight, item.best5.reps)}
								<div class="sub">{formatDateRu(item.best5.date!)}</div>
							{:else}
								—
							{/if}
						</td>
						<td data-label="Период">
							{#if item.periodStart && item.periodEnd}
								{formatDateRu(item.periodStart)} — {formatDateRu(item.periodEnd)}
							{:else}
								—
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>

{#if selectedExercise}
	<section class="card">
		<div class="toolbar">
			<div>
				<h2>Динамика 1ПМ</h2>
				<p class="muted">{selectedExercise}</p>
			</div>
			<button class="ghost" onclick={() => (selectedExercise = null)}>Закрыть</button>
		</div>

		{#if trendPoints.length === 0}
			<p class="muted">Нет точек для графика.</p>
		{:else}
			{@const max = Math.max(...trendPoints.map((p) => p.est1rm))}
			{@const min = Math.min(...trendPoints.map((p) => p.est1rm))}
			{@const span = Math.max(max - min, 1)}
			<svg viewBox="0 0 640 220" class="chart" role="img" aria-label="График 1ПМ">
				{#each trendPoints as point, index}
					{@const x = 40 + (index / Math.max(trendPoints.length - 1, 1)) * 560}
					{@const y = 190 - ((point.est1rm - min) / span) * 150}
					{#if index > 0}
						{@const prev = trendPoints[index - 1]}
						{@const px = 40 + ((index - 1) / Math.max(trendPoints.length - 1, 1)) * 560}
						{@const py = 190 - ((prev.est1rm - min) / span) * 150}
						<line x1={px} y1={py} x2={x} y2={y} stroke="rgba(110,231,168,0.85)" stroke-width="2" />
					{/if}
					<circle cx={x} cy={y} r="4" fill="#6ee7a8" />
				{/each}
			</svg>
			<ul class="trend-list">
				{#each trendPoints as point}
					<li>
						<span>{formatDateRu(point.date)}</span>
						<strong>{fmtNum(point.est1rm)} кг</strong>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<style>
	.toolbar {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: end;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}

	h2 {
		margin: 0 0 0.25rem;
	}

	.search {
		min-width: 220px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 10px;
		color: var(--text);
		padding: 0.55rem 0.75rem;
	}

	.table-wrap {
		overflow-x: auto;
	}

	.sub {
		color: var(--muted);
		font-size: 0.85rem;
		margin-top: 0.15rem;
	}

	tr.selected {
		background: rgba(91, 157, 255, 0.08);
	}

	.linkish {
		background: none;
		border: none;
		color: var(--text);
		padding: 0;
		text-align: left;
		text-decoration: underline;
		text-decoration-color: rgba(110, 231, 168, 0.35);
	}

	.ghost {
		background: transparent;
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 10px;
		padding: 0.45rem 0.75rem;
	}

	.chart {
		width: 100%;
		height: auto;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 12px;
		margin-bottom: 1rem;
	}

	.trend-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.5rem;
	}

	.trend-list li {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.55rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface-2);
	}
</style>
