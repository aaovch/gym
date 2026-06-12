<script lang="ts">
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import SetEditor from '$lib/components/SetEditor.svelte';
	import { resolveMesoMicroSelection, targetPctForExercise } from '$lib/cycle-plan';
	import {
		createLog,
		emptyRowInput,
		logToSession,
		rowInputToSessionRow,
		uniqueExercisesFromDb
	} from '$lib/database';
	import { mesoProtocolId } from '$lib/exercise-keys';
	import { fmtNum, todayIso } from '$lib/format';
	import { thesesStore } from '$lib/training-theses';
	import {
		protocolGuideWeek,
		setsToRowInput,
		suggestPlannedSets
	} from '$lib/planned-sets';
	import { TRAINING_VOLUME_GUIDE_ID } from '$lib/volume-guide';
	import { saveLog, workoutStore } from '$lib/workout-store';
	import type { ExerciseLog, RowInput, WorkoutSession } from '$lib/types';

	let exercise = $state('');
	let date = $state(todayIso());
	let mainRow = $state<RowInput>(emptyRowInput());
	let extraRows = $state<RowInput[]>([]);
	let editingId = $state<string | null>(null);
	let prefilledKey = $state<string | null>(null);
	let status = $state('');
	let error = $state('');
	let busy = $state(false);

	const view = $derived(workoutStore.view);
	const exercises = $derived(uniqueExercisesFromDb(workoutStore.database));
	const exerciseKind = $derived(
		workoutStore.database.exercises.find((item) => item.name === exercise.trim())?.kind ?? 'strength'
	);
	const editId = $derived.by(() => (browser ? page.url.searchParams.get('id') : null));
	const urlExercise = $derived.by(() => (browser ? page.url.searchParams.get('exercise') : null));
	const urlDate = $derived.by(() => (browser ? page.url.searchParams.get('date') : null));
	const urlMeso = $derived.by(() => (browser ? page.url.searchParams.get('meso') : null));
	const urlMicro = $derived.by(() => (browser ? page.url.searchParams.get('micro') : null));
	const urlSession = $derived.by(() => (browser ? page.url.searchParams.get('session') : null));

	const trainingContext = $derived.by(() =>
		resolveMesoMicroSelection(view.cyclePlanView.mesocycles, date, urlMeso, urlMicro)
	);

	const volumeGuideRows = $derived(
		thesesStore.volumeGuides.find((guide) => guide.id === TRAINING_VOLUME_GUIDE_ID)?.rows ?? []
	);

	const planSummary = $derived.by(() => {
		const name = exercise.trim();
		if (!name || !trainingContext) return null;
		const anchor = trainingContext.meso.anchorInfo[name]?.anchor;
		if (!anchor) return null;
		const protocolId =
			mesoProtocolId(trainingContext.meso.plan, name, view.keyMaps) ??
			trainingContext.meso.plan.templateId;
		const guide = thesesStore.protocolGuideFor(protocolId);
		const sets = suggestPlannedSets({
			exercise: name,
			kind: exerciseKind,
			date,
			entries: view.entries,
			anchor1rm: anchor,
			cyclePlan: view.cyclePlanForCalc,
			meso: trainingContext.meso.plan,
			micro: trainingContext.micro.plan,
			keyMaps: view.keyMaps,
			protocolGuideWeek: protocolGuideWeek(guide?.weeks, trainingContext.micro.plan.indexInMeso),
			volumeGuideRows
		});
		const weight = sets[0]?.[0];
		const { pct } = targetPctForExercise(
			view.cyclePlanForCalc,
			trainingContext.meso.plan,
			trainingContext.micro.plan,
			name,
			view.keyMaps
		);
		return weight && pct ? `${fmtNum(weight)} кг · ${pct}%` : null;
	});

	$effect(() => {
		if (editId) return;
		if (urlExercise && !exercise) exercise = urlExercise;
		if (urlDate && date === todayIso()) date = urlDate;
	});

	$effect(() => {
		if (editId) return;
		const name = urlExercise?.trim() ?? exercise.trim();
		if (!name || !trainingContext) return;
		const key = `${name}|${date}|${urlMeso ?? ''}|${urlMicro ?? ''}`;
		if (prefilledKey === key) return;

		const anchor = trainingContext.meso.anchorInfo[name]?.anchor;
		if (!anchor) return;

		const protocolId =
			mesoProtocolId(trainingContext.meso.plan, name, view.keyMaps) ??
			trainingContext.meso.plan.templateId;
		const guide = thesesStore.protocolGuideFor(protocolId);
		const kind =
			workoutStore.database.exercises.find((item) => item.name === name)?.kind ?? 'strength';
		const sets = suggestPlannedSets({
			exercise: name,
			kind,
			date,
			entries: view.entries,
			anchor1rm: anchor,
			cyclePlan: view.cyclePlanForCalc,
			meso: trainingContext.meso.plan,
			micro: trainingContext.micro.plan,
			keyMaps: view.keyMaps,
			protocolGuideWeek: protocolGuideWeek(guide?.weeks, trainingContext.micro.plan.indexInMeso),
			volumeGuideRows
		});

		exercise = name;
		mainRow = setsToRowInput(sets);
		extraRows = [];
		prefilledKey = key;
	});

	$effect(() => {
		if (!editId) return;
		const session = view.sessions.find((item) => item.id === editId);
		if (session && editingId !== editId) loadSession(session);
	});

	function loadSession(session: WorkoutSession) {
		editingId = session.id;
		prefilledKey = null;
		exercise = session.exercise;
		date = session.date;
		mainRow = sessionRowToInput(session.rows[0] ?? { kind: 'strength', sets: [], comment: null });
		extraRows = session.rows.slice(1).map((row) => sessionRowToInput(row));
	}

	function sessionRowToInput(row: WorkoutSession['rows'][number]): RowInput {
		return {
			sets: row.sets.map(([weight, reps]) => ({
				weight: String(weight).replace('.', ','),
				reps: String(reps)
			})),
			comment: row.comment ?? ''
		};
	}

	function addExtraRow() {
		extraRows = [...extraRows, emptyRowInput()];
	}

	function removeExtraRow(index: number) {
		extraRows = extraRows.filter((_, i) => i !== index);
	}

	function resetForm() {
		editingId = null;
		prefilledKey = null;
		exercise = '';
		date = todayIso();
		mainRow = emptyRowInput();
		extraRows = [];
	}

	const previewLog = $derived.by((): ExerciseLog | null => {
		const name = exercise.trim();
		if (!name) return null;
		const kind =
			workoutStore.database.exercises.find((item) => item.name === name)?.kind ?? 'strength';
		const rows = [mainRow, ...extraRows]
			.map((row) => rowInputToSessionRow(row, kind))
			.filter((row): row is NonNullable<typeof row> => row !== null);
		if (rows.length === 0) return null;
		return createLog(workoutStore.database, name, date, rows, editingId ?? crypto.randomUUID()).log;
	});

	async function submit() {
		if (!previewLog) return;
		busy = true;
		error = '';
		status = '';
		try {
			const { db, log } = createLog(
				workoutStore.database,
				exercise.trim(),
				date,
				previewLog.blocks,
				previewLog.id,
				previewLog.microSessionId
			);
			workoutStore.database = db;
			const sessionIndex = urlSession != null ? Number(urlSession) : undefined;
			const context =
				urlMeso && urlMicro && trainingContext
					? {
							mesoId: trainingContext.meso.plan.id,
							microId: trainingContext.micro.plan.id,
							indexInMicro: Number.isFinite(sessionIndex) ? sessionIndex : undefined
						}
					: undefined;
			await saveLog(log, context);
			status = editingId ? 'Тренировка обновлена.' : 'Тренировка сохранена.';
			if (!editingId) resetForm();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Не удалось сохранить';
		} finally {
			busy = false;
		}
	}
</script>

<section class="card">
	<div class="toolbar">
		<div>
			<h2>{editingId ? 'Редактировать' : 'Запись'}</h2>
			<p class="muted">
				{#if editingId}
					Подправьте подходы и сохраните.
				{:else if planSummary}
					По плану: {planSummary}. Можно сразу сохранить или изменить.
				{:else}
					Подходы подставятся из плана или прошлой тренировки.
				{/if}
			</p>
		</div>
		{#if editingId}
			<button type="button" class="ghost" onclick={resetForm}>Новая запись</button>
		{/if}
	</div>

	<form class="form" onsubmit={(event) => { event.preventDefault(); submit(); }}>
		<label>
			<span>Упражнение</span>
			<input bind:value={exercise} list="exercise-list" placeholder="Приседания со штангой на спине" />
			<datalist id="exercise-list">
				{#each exercises as name (name)}
					<option value={name}></option>
				{/each}
			</datalist>
		</label>

		<label>
			<span>Дата</span>
			<input type="date" bind:value={date} />
		</label>

		<SetEditor bind:row={mainRow} label="Подходы" kind={exerciseKind} />

		{#each extraRows as _, index (index)}
			<SetEditor
				bind:row={extraRows[index]}
				label="Дополнительный блок"
				kind={exerciseKind}
				onremove={() => removeExtraRow(index)}
			/>
		{/each}

		<div class="form-actions">
			<button type="button" class="ghost" onclick={addExtraRow}>+ блок</button>
			<button type="submit" class="primary" disabled={!previewLog || busy || workoutStore.sync.syncing}>
				{busy ? 'Сохраняем...' : editingId ? 'Обновить' : 'Сохранить'}
			</button>
		</div>
	</form>
</section>

{#if status}
	<section class="card success">{status}</section>
{/if}

{#if error}
	<section class="card error">{error}</section>
{/if}

<style>
	.toolbar {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: start;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}

	h2 {
		margin: 0 0 0.35rem;
	}

	.form {
		display: grid;
		gap: 1rem;
	}

	label {
		display: grid;
		gap: 0.35rem;
		color: var(--muted);
		font-size: 0.85rem;
	}

	label input {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 10px;
		color: var(--text);
		padding: 0.55rem 0.75rem;
	}

	.form-actions {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	button {
		border-radius: 10px;
		padding: 0.55rem 0.9rem;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
	}

	button.primary {
		background: rgba(110, 231, 168, 0.16);
		border-color: rgba(110, 231, 168, 0.45);
		color: var(--accent);
	}

	button.ghost {
		background: transparent;
	}

	button:disabled {
		opacity: 0.55;
	}

	.success {
		color: var(--accent);
	}

	.error {
		color: var(--danger);
	}
</style>
