<script lang="ts">
	import { formatDateRu, todayIso } from '$lib/format';
	import type { WorkoutEntry } from '$lib/types';

	let { data } = $props();

	let selectedDate = $state(todayIso());

	const entriesForDate = $derived(
		data.data.entries
			.filter((entry: WorkoutEntry) => entry.date === selectedDate)
			.sort((a, b) => a.exercise.localeCompare(b.exercise, 'ru'))
	);

	const availableDates = $derived(
		[...new Set(data.data.entries.map((entry: WorkoutEntry) => entry.date))].sort().reverse()
	);
</script>

<section class="card">
	<div class="toolbar">
		<div>
			<h2>План на дату</h2>
			<p class="muted">Выберите дату или оставьте сегодняшнюю.</p>
		</div>
		<label class="date-field">
			<span>Дата</span>
			<input type="date" bind:value={selectedDate} list="workout-dates" />
			<datalist id="workout-dates">
				{#each availableDates as date}
					<option value={date}></option>
				{/each}
			</datalist>
		</label>
	</div>

	{#if entriesForDate.length === 0}
		<p class="empty">Нет записей на {formatDateRu(selectedDate)}.</p>
	{:else}
		<div class="plan-list">
			{#each entriesForDate as entry}
				<article class="plan-item">
					<h3>{entry.exercise}</h3>
					<p>{entry.parts.join(' ')}</p>
					<div class="sets">
						{#each entry.sets as [weight, reps]}
							<span class="badge">{weight}×{reps}</span>
						{/each}
					</div>
				</article>
			{/each}
		</div>
	{/if}
</section>

<section class="card muted meta">
	Обновлено: {new Date(data.data.generatedAt).toLocaleString('ru-RU')}
</section>

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

	.date-field {
		display: grid;
		gap: 0.35rem;
		color: var(--muted);
		font-size: 0.85rem;
	}

	input[type='date'] {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 10px;
		color: var(--text);
		padding: 0.55rem 0.75rem;
	}

	.empty {
		margin: 0;
		color: var(--muted);
	}

	.plan-list {
		display: grid;
		gap: 0.85rem;
	}

	.plan-item {
		padding: 1rem;
		border-radius: 12px;
		background: var(--surface-2);
		border: 1px solid var(--border);
	}

	.plan-item h3 {
		margin: 0 0 0.35rem;
		font-size: 1.05rem;
	}

	.plan-item p {
		margin: 0 0 0.75rem;
		color: var(--muted);
	}

	.sets {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.meta {
		font-size: 0.9rem;
	}
</style>
