<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/stores';
	import { mesocyclePlanForDate, microcyclePlanForDate } from '$lib/cycle-plan';
	import { formatDateRu, fmtNum, todayIso } from '$lib/format';
	import { mesocycleColor, slotColor, slotLabel } from '$lib/microcycle';
	import { deleteSession, workoutView } from '$lib/workout-store';

	let selectedDate = $state(todayIso());
	let busyId = $state<string | null>(null);
	let error = $state('');

	$effect(() => {
		const fromUrl = $page.url.searchParams.get('date');
		if (fromUrl) selectedDate = fromUrl;
	});

	const trainingDay = $derived($workoutView.microcycles.byDate.get(selectedDate) ?? null);
	const mesocycle = $derived(mesocyclePlanForDate($workoutView.cyclePlanView, selectedDate));
	const microcycle = $derived(
		mesocycle ? microcyclePlanForDate(mesocycle, selectedDate) : null
	);
	const template = $derived(
		trainingDay
			? ($workoutView.microcycles.templates.find((item) => item.slot === trainingDay.slot) ?? null)
			: null
	);

	const entriesForDate = $derived(
		$workoutView.entries
			.filter((entry) => entry.date === selectedDate)
			.sort((a, b) => a.exercise.localeCompare(b.exercise, 'ru'))
	);

	const protocolHints = $derived.by(() => {
		if (!microcycle) return new Map<string, (typeof microcycle.intensityByExercise)[number]>();
		const hints = new Map<string, (typeof microcycle.intensityByExercise)[number]>();
		for (const entry of entriesForDate) {
			const row = microcycle.intensityByExercise.find(
				(item) => item.exercise === entry.exercise && !item.plannedOnly
			);
			if (row) hints.set(entry.exercise, row);
		}
		return hints;
	});

	const availableDates = $derived(
		[...new Set($workoutView.entries.map((entry) => entry.date))].sort().reverse()
	);

	async function removeEntry(id: string | undefined) {
		if (!id) return;
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
			<p class="muted">Данные в JSON — локально в браузере, опционально в GitHub.</p>
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

	{#if mesocycle}
		<div class="meso-banner" style="--meso-color: {mesocycleColor(mesocycle.index)}">
			<strong>Мезоцикл #{mesocycle.index}</strong>
			<span class="muted">
				· {mesocycle.plan.label} · {formatDateRu(mesocycle.plan.startDate)} — {formatDateRu(mesocycle.plan.endDate)}
				· микро {microcycle?.plan.indexInMeso ?? '—'}/{mesocycle.microcycles.length}
				{#if microcycle?.phase}
					· {microcycle.phase.label} ({microcycle.targetPct}% 1ПМ)
				{/if}
			</span>
		</div>
	{/if}

	{#if trainingDay && trainingDay.slot !== 'unknown'}
		<div class="cycle-banner" style="--slot-color: {slotColor(trainingDay.slot)}">
			<div>
				<span class="slot-badge">{trainingDay.slot}</span>
				<strong>{slotLabel(trainingDay.slot)}</strong>
				{#if template}
					<span class="muted"> · {template.label}</span>
				{/if}
			</div>
			{#if microcycle}
				<p class="cycle-meta muted">
					Микроцикл μ{microcycle.plan.indexInMeso}
					· {microcycle.complete ? 'полный A+B' : 'неполный'}
					{#if microcycle.targetPct != null}
						· цель {microcycle.targetPct}% 1ПМ
					{/if}
				</p>
			{/if}
		</div>
	{/if}

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
					{#if protocolHints.has(entry.exercise)}
						{@const hint = protocolHints.get(entry.exercise)!}
						<p class="protocol-hint" class:match={Math.abs(hint.maxPct - hint.targetPct) <= 3}>
							{hint.protocolLabel ? `${hint.protocolLabel}: ` : 'Протокол: '}
							цель ~{fmtNum(hint.targetWeight)} кг ({hint.targetPct}% 1ПМ)
							· факт пик {fmtNum(hint.maxPct)}%
						</p>
					{/if}
					{#if entry.id}
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

	.meso-banner {
		margin-bottom: 0.65rem;
		padding: 0.6rem 0.85rem;
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--meso-color) 40%, var(--border));
		background: color-mix(in srgb, var(--meso-color) 10%, var(--surface-2));
		font-size: 0.9rem;
	}

	.meso-banner strong {
		color: var(--meso-color);
	}

	.cycle-banner {
		margin-bottom: 1rem;
		padding: 0.75rem 0.85rem;
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--slot-color) 35%, var(--border));
		background: color-mix(in srgb, var(--slot-color) 10%, var(--surface-2));
	}

	.slot-badge {
		display: inline-grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		margin-right: 0.35rem;
		border-radius: 999px;
		background: var(--slot-color);
		color: #0f1115;
		font-size: 0.8rem;
		font-weight: 800;
	}

	.cycle-meta {
		margin: 0.35rem 0 0;
		font-size: 0.82rem;
	}

	.protocol-hint {
		margin: 0 0 0.75rem;
		font-size: 0.82rem;
		color: var(--accent-2);
	}

	.protocol-hint.match {
		color: var(--accent);
	}
</style>
