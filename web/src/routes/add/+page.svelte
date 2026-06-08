<script lang="ts">
	import { page } from '$app/stores';
	import SetEditor from '$lib/components/SetEditor.svelte';
	import { getGitHubToken } from '$lib/auth';
	import {
		createSession,
		emptyRowInput,
		rowInputToSessionRow,
		uniqueExercises
	} from '$lib/database';
	import { formatDateRu, todayIso } from '$lib/format';
	import { saveSession, syncState, workoutView } from '$lib/workout-store';
	import type { RowInput, WorkoutSession } from '$lib/types';

	let exercise = $state('');
	let date = $state(todayIso());
	let mainRow = $state<RowInput>(emptyRowInput());
	let extraRows = $state<RowInput[]>([]);
	let editingId = $state<string | null>(null);
	let status = $state('');
	let error = $state('');
	let busy = $state(false);

	const exercises = $derived(uniqueExercises($workoutView.sessions));

	let loadedParamId = $state<string | null>(null);

	$effect(() => {
		const id = $page.url.searchParams.get('id');
		if (!id || id === loadedParamId) return;
		const session = $workoutView.sessions.find((item) => item.id === id);
		if (!session) return;
		loadedParamId = id;
		loadSession(session);
	});

	function loadSession(session: WorkoutSession) {
		editingId = session.id;
		exercise = session.exercise;
		date = session.date;
		mainRow = sessionRowToInput(session.rows[0] ?? { sets: [], comment: null });
		extraRows = session.rows.slice(1).map((row) => sessionRowToInput(row));
	}

	function sessionRowToInput(row: { sets: [number, number][]; comment?: string | null }): RowInput {
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
		exercise = '';
		date = todayIso();
		mainRow = emptyRowInput();
		extraRows = [];
	}

	const previewSession = $derived.by((): WorkoutSession | null => {
		const name = exercise.trim();
		if (!name) return null;
		const rows = [mainRow, ...extraRows]
			.map(rowInputToSessionRow)
			.filter((row): row is NonNullable<typeof row> => row !== null);
		if (rows.length === 0) return null;
		return createSession(name, date, rows, editingId ?? crypto.randomUUID());
	});

	async function submit() {
		if (!previewSession) return;
		if (!getGitHubToken()) {
			error = 'Сначала добавьте GitHub token в настройках (кнопка GitHub в шапке).';
			return;
		}

		busy = true;
		error = '';
		status = '';
		try {
			await saveSession(previewSession);
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
			<h2>{editingId ? 'Редактировать тренировку' : 'Новая тренировка'}</h2>
			<p class="muted">Подходы вводятся кнопками, данные сохраняются в JSON на GitHub.</p>
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
				{#each exercises as name}
					<option value={name}></option>
				{/each}
			</datalist>
		</label>

		<label>
			<span>Дата</span>
			<input type="date" bind:value={date} />
		</label>

		<SetEditor bind:row={mainRow} label="Основной блок" />

		{#each extraRows as _, index}
			<SetEditor bind:row={extraRows[index]} label="Дополнительный блок" onremove={() => removeExtraRow(index)} />
		{/each}

		<div class="form-actions">
			<button type="button" class="ghost" onclick={addExtraRow}>+ дополнительный блок</button>
			<button type="submit" class="primary" disabled={!previewSession || busy || $syncState.syncing}>
				{busy ? 'Сохраняем...' : editingId ? 'Обновить' : 'Сохранить'}
			</button>
		</div>
	</form>
</section>

{#if previewSession}
	<section class="card">
		<h3>Предпросмотр</h3>
		<p><strong>{previewSession.exercise}</strong> · {formatDateRu(previewSession.date)}</p>
		<ul>
			{#each previewSession.rows as row}
				<li>
					{row.sets.map(([w, r]) => `${w}×${r}`).join(', ')}
					{#if row.comment}
						<span class="muted">({row.comment})</span>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

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

	h2,
	h3 {
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

	ul {
		margin: 0.5rem 0 0;
		padding-left: 1.1rem;
	}

	.success {
		color: var(--accent);
	}

	.error {
		color: var(--danger);
	}
</style>
