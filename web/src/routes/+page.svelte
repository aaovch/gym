<script lang="ts">
	import { base } from '$app/paths';
	import { formatDateRu, todayIso } from '$lib/format';
	import { deleteSession, workoutView } from '$lib/workout-store';
	import { getGitHubToken } from '$lib/auth';

	let selectedDate = $state(todayIso());
	let busyId = $state<string | null>(null);
	let error = $state('');

	const entriesForDate = $derived(
		$workoutView.entries
			.filter((entry) => entry.date === selectedDate)
			.sort((a, b) => a.exercise.localeCompare(b.exercise, 'ru'))
	);

	const availableDates = $derived(
		[...new Set($workoutView.entries.map((entry) => entry.date))].sort().reverse()
	);

	async function removeEntry(id: string | undefined) {
		if (!id || !getGitHubToken()) {
			error = 'Для удаления нужен GitHub token в настройках.';
			return;
		}
		busyId = id;
		error = '';
		try {
			await deleteSession(id);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Не удалось удалить';
		} finally {
			busyId = null;
		}
	}
</script>

<section class="card">
	<div class="toolbar">
		<div>
			<h2>План на дату</h2>
			<p class="muted">Все данные хранятся в JSON на GitHub.</p>
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
					<div class="plan-head">
						<h3>{entry.exercise}</h3>
						{#if entry.id}
							<a class="edit-link" href="{base}/add?id={entry.id}">Изменить</a>
						{/if}
					</div>
					<p>{entry.parts.join(' ')}</p>
					<div class="sets">
						{#each entry.sets as [weight, reps]}
							<span class="badge">{weight}×{reps}</span>
						{/each}
					</div>
					{#if entry.id && getGitHubToken()}
						<button
							type="button"
							class="ghost danger"
							disabled={busyId === entry.id}
							onclick={() => removeEntry(entry.id)}
						>
							{busyId === entry.id ? 'Удаляем...' : 'Удалить'}
						</button>
					{/if}
				</article>
			{/each}
		</div>
	{/if}
</section>

{#if error}
	<section class="card error">{error}</section>
{/if}

<section class="card muted meta">
	Обновлено: {new Date($workoutView.updatedAt || Date.now()).toLocaleString('ru-RU')}
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

	.plan-head {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		align-items: start;
	}

	.plan-item h3 {
		margin: 0 0 0.35rem;
		font-size: 1.05rem;
	}

	.edit-link {
		font-size: 0.9rem;
	}

	.plan-item p {
		margin: 0 0 0.75rem;
		color: var(--muted);
	}

	.sets {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-bottom: 0.75rem;
	}

	button.ghost {
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 10px;
		color: var(--text);
		padding: 0.45rem 0.75rem;
	}

	button.danger {
		color: var(--danger);
	}

	.error {
		color: var(--danger);
	}

	.meta {
		font-size: 0.9rem;
	}
</style>
