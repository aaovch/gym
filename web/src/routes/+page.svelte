<script lang="ts">
	import { base } from '$app/paths';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import {
		exerciseTargetOnMicro,
		exercisesForWorkoutSlot,
		resolveMesoMicroSelection,
		suggestWorkoutSlot
	} from '$lib/cycle-plan';
	import { formatDateRu, fmtNum, todayIso } from '$lib/format';
	import { mesocycleColor, slotColor, slotLabel, type WorkoutSlot } from '$lib/microcycle';
	import RmLabels from '$lib/components/RmLabels.svelte';
	import { thesesStore } from '$lib/training-theses';
	import {
		evaluateEntryVolume,
		resolveVolumeAnchor1rm,
		TRAINING_VOLUME_GUIDE_ID,
		volumeCheckLabel
	} from '$lib/volume-guide';
	import { deleteSession, workoutStore } from '$lib/workout-store';

	let datePick = $state(todayIso());
	let mesoPick = $state<string | null>(null);
	let microPick = $state<string | null>(null);
	let slotPick = $state<WorkoutSlot | null>(null);
	let busyId = $state<string | null>(null);
	let error = $state('');

	const urlDate = $derived.by(() => (browser ? page.url.searchParams.get('date') : null));
	const urlMeso = $derived.by(() => (browser ? page.url.searchParams.get('meso') : null));
	const urlMicro = $derived.by(() => (browser ? page.url.searchParams.get('micro') : null));
	const selectedDate = $derived(urlDate ?? datePick);
	const view = $derived(workoutStore.view);

	const mesocycles = $derived(view.cyclePlanView.mesocycles);

	const trainingContext = $derived.by(() =>
		resolveMesoMicroSelection(
			mesocycles,
			selectedDate,
			mesoPick ?? urlMeso,
			microPick ?? urlMicro
		)
	);

	const mesocycle = $derived(trainingContext?.meso ?? null);
	const microcycle = $derived(trainingContext?.micro ?? null);

	const suggestedSlot = $derived.by((): WorkoutSlot => {
		if (!microcycle) return 'A';
		return suggestWorkoutSlot(
			microcycle,
			selectedDate,
			view.entries,
			view.workoutTemplates
		);
	});

	const activeSlot = $derived(slotPick ?? suggestedSlot);

	const slotExercises = $derived.by(() => {
		if (!mesocycle) return [];
		return exercisesForWorkoutSlot(mesocycle, view.workoutTemplates, activeSlot);
	});

	const trainingDay = $derived(view.microcycles.byDate.get(selectedDate) ?? null);
	const template = $derived(
		view.workoutTemplates.find((item) => item.slot === activeSlot) ?? null
	);

	const entriesForDate = $derived(
		view.entries
			.filter((entry) => entry.date === selectedDate)
			.sort((a, b) => a.exercise.localeCompare(b.exercise, 'ru'))
	);

	const entryByExercise = $derived(new Map(entriesForDate.map((entry) => [entry.exercise, entry])));

	const protocolHints = $derived.by(() => {
		if (!mesocycle || !microcycle) {
			return new Map<string, NonNullable<ReturnType<typeof exerciseTargetOnMicro>>>();
		}
		const hints = new Map<string, NonNullable<ReturnType<typeof exerciseTargetOnMicro>>>();
		for (const exercise of slotExercises) {
			const anchor = mesocycle.anchorInfo[exercise]?.anchor;
			if (!anchor) continue;
			const entry = entryByExercise.get(exercise);
			const row = exerciseTargetOnMicro(
				view.cyclePlanForCalc,
				mesocycle.plan,
				microcycle.plan,
				exercise,
				anchor,
				entry
			);
			if (row) hints.set(exercise, row);
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

	function addUrl(exercise: string, entryId?: string): string {
		const params = new URLSearchParams();
		if (entryId) params.set('id', entryId);
		else params.set('exercise', exercise);
		params.set('date', selectedDate);
		if (mesocycle) params.set('meso', mesocycle.plan.id);
		if (microcycle) params.set('micro', microcycle.plan.id);
		params.set('slot', activeSlot);
		return `${base}/add?${params.toString()}`;
	}

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
			<h2>Тренировка на сегодня</h2>
			<p class="muted">Выбери микроцикл — увидишь цели по протоколу и сможешь занести подходы.</p>
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

	{#if mesocycles.length === 0}
		<p class="empty">
			Нет плана циклов. Создай мезоцикл на вкладке
			<a href="{base}/cycles">Циклы</a> или импортируй из истории тренировок.
		</p>
	{:else}
		<div class="cycle-pickers">
			<div class="picker-block">
				<span class="picker-label">Мезоцикл</span>
				<div class="picker-tabs">
					{#each mesocycles as meso (meso.plan.id)}
						<button
							type="button"
							class="picker-tab"
							class:active={mesocycle?.plan.id === meso.plan.id}
							style="--meso-color: {mesocycleColor(meso.index)}"
							onclick={() => {
								mesoPick = meso.plan.id;
								microPick = meso.microcycles[0]?.plan.id ?? null;
								slotPick = null;
							}}
						>
							<span class="tab-num">#{meso.index}</span>
							<span class="tab-label">{meso.plan.label}</span>
						</button>
					{/each}
				</div>
			</div>

			{#if mesocycle && mesocycle.microcycles.length > 0}
				<div class="picker-block">
					<span class="picker-label">Микроцикл</span>
					<div class="picker-tabs micro-tabs">
						{#each mesocycle.microcycles as micro (micro.plan.id)}
							<button
								type="button"
								class="picker-tab micro-tab"
								class:active={microcycle?.plan.id === micro.plan.id}
								class:complete={micro.complete}
								onclick={() => {
									microPick = micro.plan.id;
									slotPick = null;
								}}
							>
								μ{micro.plan.indexInMeso}
								{#if micro.complete}
									<span class="micro-ok">✓</span>
								{/if}
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		{#if mesocycle && microcycle}
			<div class="meso-banner" style="--meso-color: {mesocycleColor(mesocycle.index)}">
				<strong>μ{microcycle.plan.indexInMeso}</strong>
				<span class="muted">
					· {mesocycle.plan.label} · {formatDateRu(mesocycle.plan.startDate)} — {formatDateRu(mesocycle.plan.endDate)}
					· {microcycle.complete ? 'полный A+B' : 'неполный'}
				</span>
			</div>

			<div class="slot-picker">
				<span class="picker-label">Тренировка</span>
				<div class="slot-tabs">
					{#each ['A', 'B'] as slot (slot)}
						<button
							type="button"
							class="slot-tab"
							class:active={activeSlot === slot}
							style="--slot-color: {slotColor(slot)}"
							onclick={() => (slotPick = slot)}
						>
							<span class="slot-badge">{slot}</span>
							{slotLabel(slot)}
							{#if template && activeSlot === slot}
								<span class="muted"> · {template.label}</span>
							{/if}
						</button>
					{/each}
				</div>
			</div>

			{#if slotExercises.length > 0}
				<div class="workout-plan">
					<h3>Упражнения · {slotLabel(activeSlot)}</h3>
					<div class="exercise-cards">
						{#each slotExercises as exercise (exercise)}
							{@const entry = entryByExercise.get(exercise)}
							{@const hint = protocolHints.get(exercise)}
							{@const rm = mesocycle?.anchorInfo[exercise]}
							<article class="exercise-card" class:logged={Boolean(entry)}>
								<div class="exercise-head">
									<h4>{exercise}</h4>
									<a class="action-link" href={addUrl(exercise, entry?.id)}>
										{entry ? 'Изменить' : 'Записать'}
									</a>
								</div>
								{#if hint || rm}
									<div class="target-hint">
										{#if rm}
											<RmLabels
												anchor={rm.anchor}
												current={rm.current1rm}
												currentDate={rm.current1rmDate}
											/>
										{/if}
										{#if hint}
											<p>
												{hint.protocolLabel}: цель ~{fmtNum(hint.targetWeight)} кг ({hint.targetPct}% от якоря)
											</p>
										{/if}
									</div>
								{/if}
								{#if entry}
									<div class="sets">
										{#each entry.sets as [weight, reps]}
											<span class="badge">{weight}×{reps}</span>
										{/each}
									</div>
									{#if hint && !hint.plannedOnly}
										<p
											class="fact-hint"
											class:match={Math.abs(hint.maxPct - hint.targetPct) <= 3}
										>
											Факт пик {fmtNum(hint.maxPct)}% от якоря · {fmtNum(hint.maxWeight)} кг
										</p>
									{/if}
									{#if volumeHints.has(exercise)}
										{@const volume = volumeHints.get(exercise)!}
										<p
											class="volume-hint"
											class:ok={volume.status === 'ok'}
											class:low={volume.status === 'low'}
											class:high={volume.status === 'high'}
										>
											{volumeCheckLabel(volume)}
										</p>
									{/if}
								{:else}
									<p class="muted pending">Ещё не записано</p>
								{/if}
							</article>
						{/each}
					</div>
				</div>
			{:else}
				<p class="empty">В этом мезо нет упражнений для тренировки {activeSlot}. Настрой их на вкладке Циклы.</p>
			{/if}
		{/if}
	{/if}
</section>

{#if entriesForDate.length > 0}
	<section class="card">
		<h3>Все записи на {formatDateRu(selectedDate)}</h3>
		<div class="plan-list">
			{#each entriesForDate as entry (entry.id ?? `${entry.exercise}-${entry.date}`)}
				<article class="plan-item">
					<div class="plan-head">
						<h3>{entry.exercise}</h3>
						{#if entry.id}
							<a class="edit-link" href={addUrl(entry.exercise, entry.id)}>Изменить</a>
						{/if}
					</div>
					<p>{entry.parts.join(' ')}</p>
					<div class="sets">
						{#each entry.sets as [weight, reps]}
							<span class="badge">{weight}×{reps}</span>
						{/each}
					</div>
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
	</section>
{/if}

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

	h2,
	h3,
	h4 {
		margin: 0;
	}

	h3 {
		margin-bottom: 0.75rem;
		font-size: 0.95rem;
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

	.cycle-pickers {
		display: grid;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.picker-block {
		display: grid;
		gap: 0.35rem;
	}

	.picker-label {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.picker-tabs {
		display: flex;
		gap: 0.4rem;
		overflow-x: auto;
		padding-bottom: 0.15rem;
	}

	.picker-tab {
		flex: 0 0 auto;
		padding: 0.45rem 0.7rem;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		text-align: left;
		font-size: 0.82rem;
	}

	.picker-tab.active {
		border-color: color-mix(in srgb, var(--meso-color, var(--accent)) 50%, var(--border));
		background: color-mix(in srgb, var(--meso-color, var(--accent)) 12%, var(--surface-2));
	}

	.tab-num {
		display: block;
		font-weight: 800;
		color: var(--meso-color, var(--accent));
		font-size: 0.78rem;
	}

	.tab-label {
		display: block;
		margin-top: 0.1rem;
		white-space: nowrap;
	}

	.micro-tab {
		min-width: 2.75rem;
		text-align: center;
		font-weight: 700;
	}

	.micro-tab.complete {
		border-color: rgba(110, 231, 168, 0.3);
	}

	.micro-ok {
		margin-left: 0.2rem;
		color: var(--accent);
		font-size: 0.75rem;
	}

	.meso-banner {
		margin-bottom: 0.75rem;
		padding: 0.6rem 0.85rem;
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--meso-color) 40%, var(--border));
		background: color-mix(in srgb, var(--meso-color) 10%, var(--surface-2));
		font-size: 0.9rem;
	}

	.meso-banner strong {
		color: var(--meso-color);
	}

	.slot-picker {
		display: grid;
		gap: 0.35rem;
		margin-bottom: 1rem;
	}

	.slot-tabs {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.slot-tab {
		padding: 0.45rem 0.75rem;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 0.85rem;
	}

	.slot-tab.active {
		border-color: color-mix(in srgb, var(--slot-color) 45%, var(--border));
		background: color-mix(in srgb, var(--slot-color) 12%, var(--surface-2));
	}

	.slot-badge {
		display: inline-grid;
		place-items: center;
		width: 1.35rem;
		height: 1.35rem;
		margin-right: 0.3rem;
		border-radius: 999px;
		background: var(--slot-color);
		color: #0f1115;
		font-size: 0.72rem;
		font-weight: 800;
		vertical-align: middle;
	}

	.exercise-cards {
		display: grid;
		gap: 0.65rem;
	}

	.exercise-card {
		padding: 0.85rem;
		border-radius: 12px;
		border: 1px solid var(--border);
		background: var(--surface-2);
	}

	.exercise-card.logged {
		border-color: rgba(110, 231, 168, 0.25);
	}

	.exercise-head {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		align-items: start;
		margin-bottom: 0.35rem;
	}

	.exercise-head h4 {
		font-size: 1rem;
	}

	.action-link {
		font-size: 0.88rem;
		white-space: nowrap;
	}

	.target-hint {
		display: grid;
		gap: 0.35rem;
		margin: 0 0 0.5rem;
		font-size: 0.82rem;
		color: var(--accent-2);
	}

	.target-hint p {
		margin: 0;
	}

	.fact-hint {
		margin: 0.35rem 0 0;
		font-size: 0.82rem;
		color: var(--accent-2);
	}

	.fact-hint.match {
		color: var(--accent);
	}

	.pending {
		margin: 0;
		font-size: 0.82rem;
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
		margin-bottom: 0.5rem;
	}

	.badge {
		padding: 0.2rem 0.45rem;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface);
		font-size: 0.82rem;
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

	.volume-hint {
		margin: 0.35rem 0 0;
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
