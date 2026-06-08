<script lang="ts">
	import { page } from '$app/stores';
	import { base } from '$app/paths';
	import { uniqueExercises } from '$lib/database';
	import { fmtNum, fmtSet, formatDateRu } from '$lib/format';
	import { exerciseHistory } from '$lib/history';
	import { workoutView } from '$lib/workout-store';

	let exercise = $state('');
	let query = $state('');
	let sortOrder = $state<'new' | 'old'>('new');

	const exercises = $derived(uniqueExercises($workoutView.sessions));
	const newestFirst = $derived(sortOrder === 'new');

	const filteredExercises = $derived(
		exercises.filter((name) => name.toLowerCase().includes(query.trim().toLowerCase()))
	);

	$effect(() => {
		const fromUrl = $page.url.searchParams.get('exercise');
		if (fromUrl && !exercise) exercise = fromUrl;
	});

	const history = $derived(
		exercise.trim() ? exerciseHistory($workoutView.sessions, exercise.trim(), newestFirst) : []
	);

	const summary = $derived.by(() => {
		if (history.length === 0) return null;
		const dates = history.map((item) => item.session.date).sort();
		const totalSets = history.reduce((sum, item) => sum + item.allSets.length, 0);
		const best1rm = Math.max(...history.map((item) => item.est1rm));
		return {
			sessions: history.length,
			sets: totalSets,
			from: dates[0],
			to: dates[dates.length - 1],
			best1rm
		};
	});
</script>

<section class="card">
	<div class="toolbar">
		<div>
			<h2>История подходов</h2>
			<p class="muted">Все тренировки по выбранному упражнению в хронологическом порядке.</p>
		</div>
		<label class="sort-field">
			<span>Порядок</span>
			<select bind:value={sortOrder}>
				<option value="new">Сначала новые</option>
				<option value="old">Сначала старые</option>
			</select>
		</label>
	</div>

	<div class="picker">
		<label>
			<span>Упражнение</span>
			<input
				bind:value={exercise}
				list="history-exercises"
				placeholder="Начните вводить название..."
			/>
			<datalist id="history-exercises">
				{#each exercises as name}
					<option value={name}></option>
				{/each}
			</datalist>
		</label>
		<label>
			<span>Фильтр списка</span>
			<input bind:value={query} type="search" placeholder="Присед..." />
		</label>
	</div>

	{#if query.trim() && !exercise.trim()}
		<div class="exercise-chips">
			{#each filteredExercises.slice(0, 12) as name}
				<button type="button" class="chip" onclick={() => (exercise = name)}>{name}</button>
			{/each}
		</div>
	{/if}
</section>

{#if exercise.trim() && summary}
	<section class="card summary">
		<div class="summary-grid">
			<div>
				<p class="label">Сессий</p>
				<p class="value">{summary.sessions}</p>
			</div>
			<div>
				<p class="label">Подходов</p>
				<p class="value">{summary.sets}</p>
			</div>
			<div>
				<p class="label">Лучшая 1ПМ</p>
				<p class="value">{fmtNum(summary.best1rm)} кг</p>
			</div>
			<div>
				<p class="label">Период</p>
				<p class="value small">{formatDateRu(summary.from)} — {formatDateRu(summary.to)}</p>
			</div>
		</div>
	</section>
{/if}

{#if !exercise.trim()}
	<section class="card muted">Выберите упражнение, чтобы увидеть историю подходов.</section>
{:else if history.length === 0}
	<section class="card muted">Нет записей для «{exercise}».</section>
{:else}
	<section class="timeline">
		{#each history as item}
			<article class="card session-card">
				<div class="session-head">
					<div>
						<p class="date">{formatDateRu(item.session.date)}</p>
						<p class="muted meta-line">
							{item.allSets.length} подх. · тоннаж {fmtNum(item.tonnage)} кг · 1ПМ {fmtNum(item.est1rm)} кг
						</p>
					</div>
					<a class="edit-link" href="{base}/add?id={item.session.id}">Изменить</a>
				</div>

				{#each item.session.rows as row}
					{#if row.sets.length > 0}
						<div class="row-block">
							<div class="sets">
								{#each row.sets as [weight, reps]}
									<span
										class="badge"
										class:best={weight === item.bestSet[0] && reps === item.bestSet[1]}
									>
										{fmtSet(weight, reps)}
									</span>
								{/each}
							</div>
							{#if row.comment}
								<p class="comment muted">{row.comment}</p>
							{/if}
						</div>
					{/if}
				{/each}
			</article>
		{/each}
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

	.sort-field,
	.picker label {
		display: grid;
		gap: 0.35rem;
		font-size: 0.85rem;
		color: var(--muted);
	}

	.picker {
		display: grid;
		grid-template-columns: 2fr 1fr;
		gap: 0.75rem;
	}

	input,
	select {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 10px;
		color: var(--text);
		padding: 0.55rem 0.75rem;
	}

	.exercise-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	.chip {
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		border-radius: 999px;
		padding: 0.4rem 0.75rem;
	}

	.summary-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 1rem;
	}

	.label {
		margin: 0;
		color: var(--muted);
		font-size: 0.85rem;
	}

	.value {
		margin: 0.2rem 0 0;
		font-size: 1.35rem;
		font-weight: 700;
	}

	.value.small {
		font-size: 1rem;
		font-weight: 600;
	}

	.timeline {
		display: grid;
		gap: 0.85rem;
	}

	.session-card {
		display: grid;
		gap: 0.75rem;
	}

	.session-head {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		align-items: start;
	}

	.date {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
	}

	.meta-line {
		margin: 0.25rem 0 0;
		font-size: 0.9rem;
	}

	.edit-link {
		font-size: 0.9rem;
		white-space: nowrap;
	}

	.row-block + .row-block {
		padding-top: 0.5rem;
		border-top: 1px dashed var(--border);
	}

	.sets {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.badge.best {
		border-color: rgba(110, 231, 168, 0.55);
		background: rgba(110, 231, 168, 0.14);
		color: var(--accent);
	}

	.comment {
		margin: 0.35rem 0 0;
		font-size: 0.85rem;
	}

	@media (max-width: 720px) {
		.picker {
			grid-template-columns: 1fr;
		}
	}
</style>
