<script lang="ts">
	import { base } from '$app/paths';
	import MuscleMap from '$lib/components/MuscleMap.svelte';
	import TrendChart from '$lib/components/TrendChart.svelte';
	import { fmtNum, fmtSet } from '$lib/format';
	import {
		buildBlockOverview,
		blocksWithData,
		type MovementBlockId
	} from '$lib/muscle-groups';
	import { uniqueExercises } from '$lib/database';
	import { workoutStore } from '$lib/workout-store';

	let selectedBlock = $state<MovementBlockId | null>(null);

	const view = $derived(workoutStore.view);

	const sessionCounts = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const session of view.sessions) {
			counts.set(session.exercise, (counts.get(session.exercise) ?? 0) + 1);
		}
		return counts;
	});

	const overview = $derived(
		buildBlockOverview(
			uniqueExercises(view.sessions),
			view.summary,
			view.trend,
			sessionCounts
		)
	);

	const activeBlocks = $derived(blocksWithData(overview));

	const selectedOverview = $derived(
		selectedBlock ? (overview.find((item) => item.block.id === selectedBlock) ?? null) : null
	);

	const unmappedExercises = $derived(
		uniqueExercises(view.sessions).filter(
			(exercise) => !overview.some((item) => item.exercises.some((row) => row.exercise === exercise))
		)
	);

	function toggleBlock(id: MovementBlockId) {
		selectedBlock = selectedBlock === id ? null : id;
	}

	function sessionWord(n: number): string {
		const mod10 = n % 10;
		const mod100 = n % 100;
		if (mod10 === 1 && mod100 !== 11) return 'сессия';
		if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'сессии';
		return 'сессий';
	}
</script>

<section class="card intro">
	<div>
		<h2>Карта блоков движения</h2>
		<p class="muted">
			Это карта паттернов движения (жимы, тяги, присед, таз и т.д.), а не анатомическая карта мышц.
			Выбери зону или пункт легенды — увидишь упражнения блока и динамику 1ПМ.
		</p>
	</div>
	<a class="button button-secondary" href="{base}/load">Нагрузка по блокам</a>
</section>

<section class="body-layout">
	<div class="card map-panel">
		<MuscleMap
			{activeBlocks}
			selected={selectedBlock}
			onselect={toggleBlock}
		/>
	</div>

	<div class="details-panel">
		{#if !workoutStore.bootstrapped}
			<section class="card"><p class="muted">Загрузка журнала…</p></section>
		{:else if selectedOverview}
			<section class="card block-detail" style="--block-color: {selectedOverview.block.color}">
				<div class="block-head">
					<div>
						<p class="eyebrow">Блок</p>
						<h3>{selectedOverview.block.label}</h3>
						<p class="muted">{selectedOverview.block.description}</p>
					</div>
					<button type="button" class="button button-ghost button-sm" onclick={() => (selectedBlock = null)}>Закрыть</button>
				</div>

				<div class="exercise-cards">
					{#each selectedOverview.exercises as item}
						<article class="exercise-card">
							<div class="exercise-head">
								<div>
									<h4>{item.exercise}</h4>
									<p class="muted meta">
										{item.sessions} {sessionWord(item.sessions)}
										{#if item.summary?.best1rm.date}
											· 1ПМ {fmtNum(item.summary.best1rm.value)} кг
											({fmtSet(item.summary.best1rm.weight, item.summary.best1rm.reps)})
										{/if}
									</p>
								</div>
								<a class="history-link" href="{base}/history?exercise={encodeURIComponent(item.exercise)}">
									история
								</a>
							</div>

							{#if item.summary && item.trend.length >= 2}
								<TrendChart
									title="Динамика 1ПМ"
									points={item.trend}
									color={selectedOverview.block.color}
									compact
								/>
							{:else if item.summary && item.trend.length === 1}
								<p class="muted note">Одна тренировка — для динамики 1ПМ нужно минимум две.</p>
							{:else if item.sessions > 0}
								<p class="muted note">
									{item.sessions} {sessionWord(item.sessions)} — график 1ПМ не применим.
								</p>
							{:else}
								<p class="muted note">Нет записей.</p>
							{/if}
						</article>
					{/each}
				</div>
			</section>
		{:else if overview.length === 0}
			<section class="card overview">
				<h3>Пока нет данных</h3>
				<p class="muted">
					Запишите силовые тренировки — здесь появятся блоки движения и динамика 1ПМ.
				</p>
				<a class="button button-primary intro-cta" href="{base}/add">Записать тренировку</a>
			</section>
		{:else}
			<section class="card overview">
				<h3>Блоки с данными</h3>
				<p class="muted">Выбери зону на карте или карточку ниже.</p>

				<div class="overview-grid">
					{#each overview as item}
						<button
							type="button"
							class="overview-card"
							style="--block-color: {item.block.color}"
							onclick={() => (selectedBlock = item.block.id)}
						>
							<span class="swatch"></span>
							<div>
								<strong>{item.block.label}</strong>
								<p class="muted">
									{item.exercises.length}
									{item.exercises.length === 1 ? 'упражнение' : 'упражнений'}
								</p>
							</div>
						</button>
					{/each}
				</div>
			</section>
		{/if}

		{#if unmappedExercises.length > 0}
			<section class="card unmapped">
				<h3>Без блока</h3>
				<p class="muted">Упражнения, которые пока не привязаны к карте:</p>
				<ul>
					{#each unmappedExercises as exercise}
						<li>{exercise}</li>
					{/each}
				</ul>
			</section>
		{/if}
	</div>
</section>

<style>
	.intro {
		display: flex;
		justify-content: space-between;
		align-items: start;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.intro h2 {
		margin: 0 0 0.25rem;
	}

	.intro-cta {
		margin-top: 0.85rem;
	}

	.body-layout {
		display: grid;
		grid-template-columns: minmax(240px, 320px) 1fr;
		gap: 1rem;
		align-items: start;
	}

	.map-panel {
		position: sticky;
		top: 1rem;
	}

	.details-panel {
		display: grid;
		gap: 1rem;
	}

	.block-detail {
		border-color: color-mix(in srgb, var(--block-color) 35%, var(--border));
	}

	.block-head {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: start;
		margin-bottom: 1rem;
	}

	.eyebrow {
		margin: 0 0 0.2rem;
		font-size: 0.8rem;
		color: var(--block-color);
	}

	h3 {
		margin: 0 0 0.35rem;
	}

	h4 {
		margin: 0 0 0.25rem;
		font-size: 1rem;
	}

	.exercise-cards {
		display: grid;
		gap: 0.85rem;
	}

	.exercise-card {
		display: grid;
		gap: 0.65rem;
		padding: 0.85rem;
		border: 1px solid var(--border);
		border-radius: 0;
		background: var(--surface-2);
	}

	.exercise-head {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		align-items: start;
	}

	.meta,
	.note {
		margin: 0;
		font-size: 0.85rem;
	}

	.history-link {
		font-size: 0.85rem;
		white-space: nowrap;
	}

	.overview h3 {
		margin: 0 0 0.25rem;
	}

	.overview-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.65rem;
		margin-top: 1rem;
	}

	.overview-card {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		text-align: left;
		padding: 0.75rem;
		border-radius: 0;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
	}

	.overview-card:hover {
		border-color: color-mix(in srgb, var(--block-color) 40%, var(--border));
	}

	.swatch {
		width: 12px;
		height: 12px;
		border-radius: 0;
		background: var(--block-color);
		flex-shrink: 0;
	}

	.unmapped h3 {
		margin: 0 0 0.25rem;
	}

	.unmapped ul {
		margin: 0.5rem 0 0;
		padding-left: 1.1rem;
		color: var(--muted);
	}

	@media (max-width: 860px) {
		.body-layout {
			grid-template-columns: 1fr;
		}

		.map-panel {
			position: static;
		}
	}
</style>
