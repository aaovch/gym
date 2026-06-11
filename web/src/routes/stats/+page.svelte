<script lang="ts">
	import { base } from '$app/paths';
	import TrendChart from '$lib/components/TrendChart.svelte';
	import { fmtNum, fmtSet, formatDateRu } from '$lib/format';
	import { workoutStore } from '$lib/workout-store';
	import type { StrengthSummary, TrendPoint } from '$lib/types';

	let query = $state('');
	let selectedExercise = $state<string | null>(null);

	const view = $derived(workoutStore.view);

	const strengthSummary = $derived(
		view.summary.filter((item): item is StrengthSummary => item.kind === 'strength')
	);

	const filtered = $derived(
		strengthSummary.filter((item) => item.exercise.toLowerCase().includes(query.trim().toLowerCase()))
	);

	const trendPoints = $derived<TrendPoint[]>(
		selectedExercise ? (view.trend[selectedExercise] ?? []) : []
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
		<table class="stack-table">
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
							<div class="name-cell">
								<button class="linkish" onclick={() => selectExercise(item.exercise)}>
									{item.exercise}
								</button>
								<a class="history-link" href="{base}/history?exercise={encodeURIComponent(item.exercise)}">
									история
								</a>
							</div>
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

		<TrendChart title="1ПМ по датам" points={trendPoints} />
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

	.name-cell {
		display: grid;
		gap: 0.2rem;
	}

	.history-link {
		font-size: 0.8rem;
		color: var(--muted);
		text-decoration: none;
	}

	.history-link:hover {
		color: var(--accent-2);
	}

	.ghost {
		background: transparent;
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 10px;
		padding: 0.45rem 0.75rem;
	}

</style>
