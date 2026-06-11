<script lang="ts">
	import { base } from '$app/paths';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { mesocyclePlanForDate, microcyclePlanForDate, exerciseTargetOnMicro } from '$lib/cycle-plan';
	import { formatDateRu, fmtNum, todayIso } from '$lib/format';
	import { mesocycleColor, slotColor, slotLabel } from '$lib/microcycle';
	import { thesesStore } from '$lib/training-theses';
	import {
		evaluateEntryVolume,
		resolveVolumeAnchor1rm,
		TRAINING_VOLUME_GUIDE_ID,
		volumeCheckLabel
	} from '$lib/volume-guide';
	import { deleteSession, workoutStore } from '$lib/workout-store';

	let datePick = $state(todayIso());
	let busyId = $state<string | null>(null);
	let error = $state('');

	const urlDate = $derived.by(() => (browser ? page.url.searchParams.get('date') : null));
	const selectedDate = $derived(urlDate ?? datePick);
	const view = $derived(workoutStore.view);

	const trainingDay = $derived(view.microcycles.byDate.get(selectedDate) ?? null);
	const mesocycle = $derived(mesocyclePlanForDate(view.cyclePlanView, selectedDate));
	const microcycle = $derived(
		mesocycle ? microcyclePlanForDate(mesocycle, selectedDate) : null
	);
	const template = $derived(
		trainingDay
			? (view.microcycles.templates.find((item) => item.slot === trainingDay.slot) ?? null)
			: null
	);

	const entriesForDate = $derived(
		view.entries
			.filter((entry) => entry.date === selectedDate)
			.sort((a, b) => a.exercise.localeCompare(b.exercise, 'ru'))
	);

	const protocolHints = $derived.by(() => {
		if (!mesocycle || !microcycle) {
			return new Map<string, NonNullable<ReturnType<typeof exerciseTargetOnMicro>>>();
		}
		const hints = new Map<string, NonNullable<ReturnType<typeof exerciseTargetOnMicro>>>();
		for (const entry of entriesForDate) {
			const anchor = mesocycle.anchorInfo[entry.exercise]?.anchor;
			if (!anchor) continue;
			const row = exerciseTargetOnMicro(
				view.cyclePlanForCalc,
				mesocycle.plan,
				microcycle.plan,
				entry.exercise,
				anchor,
				entry
			);
			if (row) hints.set(entry.exercise, row);
		}
		return hints;
	});

	const volumeGuideRows = $derived(
		thesesStore.volumeGuides.find((guide) => guide.id === TRAINING_VOLUME_GUIDE_ID)?.rows ?? []
	);

	const volumeHints = $derived.by(() => {
		if (volumeGuideRows.length === 0) return new Map<string, NonNullable<ReturnType<typeof evaluateEntryVolume>>>();
		const hints = new Map<string, NonNullable<ReturnType<typeof evaluateEntryVolume>>>();
		for (const entry of entriesForDate) {
			const mesoAnchor = mesocycle?.anchorInfo[entry.exercise]?.anchor;
			const anchor = resolveVolumeAnchor1rm(
				view.entries,
				entry.exercise,
				entry.date,
				mesoAnchor,
				entry.id
			);
			const check = evaluateEntryVolume(entry, anchor, volumeGuideRows);
			if (check) hints.set(entry.exercise, check);
		}
		return hints;
	});

	const availableDates = $derived(
		[...new Set(view.entries.map((entry) => entry.date))].sort().reverse()
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
			<input type="date" value={selectedDate} oninput={(e) => (datePick = e.currentTarget.value)} list="workout-dates" />
			<datalist id="workout-dates">
				{#each availableDates as date (date)}
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
				</p>
			{/if}
		</div>
	{/if}

	{#if entriesForDate.length === 0}
		<p class="empty">Нет записей на {formatDateRu(selectedDate)}.</p>
	{:else}
		<div class="plan-list">
			{#each entriesForDate as entry (entry.id ?? `${entry.exercise}-${entry.date}`)}
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
							{hint.protocolLabel}: 1ПМ {fmtNum(hint.anchor1rm)} кг · цель ~{fmtNum(hint.targetWeight)} кг
							({hint.targetPct}%) · факт пик {fmtNum(hint.maxPct)}%
						</p>
					{/if}
					{#if volumeHints.has(entry.exercise)}
						{@const volume = volumeHints.get(entry.exercise)!}
						<p
							class="volume-hint"
							class:ok={volume.status === 'ok'}
							class:low={volume.status === 'low'}
							class:high={volume.status === 'high'}
						>
							{volumeCheckLabel(volume)}
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
	Обновлено: {new Date(view.updatedAt || Date.now()).toLocaleString('ru-RU')}
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

	.volume-hint {
		margin: 0 0 0.75rem;
		font-size: 0.82rem;
		color: var(--accent-2);
	}

	.volume-hint.ok {
		color: var(--accent);
	}

	.volume-hint.low {
		color: #fbbf24;
	}

	.volume-hint.high {
		color: var(--danger);
	}
</style>
