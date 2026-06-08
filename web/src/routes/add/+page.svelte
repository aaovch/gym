<script lang="ts">
	import { base } from '$app/paths';
	import {
		appendDraftToMarkdown,
		draftToMarkdownRows,
		parseSetsText,
		type DraftEntry,
		type DraftRow
	} from '$lib/markdown';
	import { uniqueExercises } from '$lib/merged-data';
	import { commitMarkdownFile, fetchMarkdownFile, verifyGitHubToken } from '$lib/github';
	import { getGitHubToken, pendingStore, setGitHubToken } from '$lib/pending';
	import { formatDateRu, todayIso } from '$lib/format';

	let { data } = $props();

	let exercise = $state('');
	let date = $state(todayIso());
	let setsText = $state('');
	let comment = $state('');
	let continuationSets = $state<string[]>([]);
	let continuationComment = $state<string[]>([]);
	let githubToken = $state(getGitHubToken());
	let showToken = $state(false);
	let status = $state('');
	let error = $state('');
	let busy = $state(false);

	const exercises = $derived(uniqueExercises(data.data));

	const draft = $derived.by((): DraftEntry | null => {
		const name = exercise.trim();
		const mainSets = parseSetsText(setsText);
		if (!name || mainSets.length === 0) return null;

		const rows: DraftRow[] = [{ date, sets: mainSets, comment: comment || undefined }];
		for (let i = 0; i < continuationSets.length; i += 1) {
			const sets = parseSetsText(continuationSets[i] ?? '');
			if (sets.length === 0) continue;
			rows.push({
				date: null,
				sets,
				comment: continuationComment[i] || undefined
			});
		}

		return { exercise: name, rows };
	});

	const previewLines = $derived(draft ? draftToMarkdownRows(draft) : []);

	function addContinuationRow() {
		continuationSets = [...continuationSets, ''];
		continuationComment = [...continuationComment, ''];
	}

	function removeContinuationRow(index: number) {
		continuationSets = continuationSets.filter((_, i) => i !== index);
		continuationComment = continuationComment.filter((_, i) => i !== index);
	}

	async function copyPreview() {
		if (previewLines.length === 0) return;
		await navigator.clipboard.writeText(previewLines.join('\n'));
		status = 'Строки markdown скопированы в буфер обмена.';
		error = '';
	}

	function saveLocally() {
		if (!draft) return;
		pendingStore.add(draft);
		status = 'Запись сохранена локально и уже видна на других вкладках сайта.';
		error = '';
		setsText = '';
		comment = '';
		continuationSets = [];
		continuationComment = [];
	}

	async function saveToGitHub() {
		if (!draft) return;
		if (!githubToken.trim()) {
			error = 'Нужен GitHub token с правом записи в репозиторий.';
			return;
		}

		busy = true;
		error = '';
		status = 'Сохраняем в GitHub...';

		try {
			setGitHubToken(githubToken);
			await verifyGitHubToken(githubToken);
			const { content, sha } = await fetchMarkdownFile(githubToken);
			const updated = appendDraftToMarkdown(content, draft);
			const message = `Add workout: ${draft.exercise} (${draft.rows[0]?.date ?? 'continuation'})`;
			await commitMarkdownFile(githubToken, updated, sha, message);
			status =
				'Запись отправлена в репозиторий. Через 1–2 минуты сайт обновится после GitHub Actions.';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Не удалось сохранить в GitHub.';
			status = '';
		} finally {
			busy = false;
		}
	}
</script>

<section class="card">
	<div class="toolbar">
		<div>
			<h2>Добавить тренировку</h2>
			<p class="muted">Запись попадёт в markdown-файл в том же формате, что и текущий план.</p>
		</div>
	</div>

	<form class="form" onsubmit={(event) => event.preventDefault()}>
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

		<label>
			<span>Подходы</span>
			<input
				bind:value={setsText}
				placeholder="100×5, 105×5, 110×5"
				autocomplete="off"
			/>
			<small class="muted">Формат: вес×повторы через запятую. Можно с десятичной запятой: 107,5×5</small>
		</label>

		<label>
			<span>Комментарий</span>
			<input bind:value={comment} placeholder="все кластерно" />
		</label>

		<div class="continuations">
			<div class="continuations-head">
				<strong>Строки продолжения</strong>
				<button type="button" class="ghost" onclick={addContinuationRow}>+ строка без даты</button>
			</div>
			<p class="muted small">
				Для нескольких табличных строк в одной тренировке, как в markdown-логе.
			</p>
			{#each continuationSets as _, index}
				<div class="continuation-row">
					<input bind:value={continuationSets[index]} placeholder="110×5, 115×5, 120×5" />
					<input bind:value={continuationComment[index]} placeholder="комментарий" />
					<button type="button" class="ghost danger" onclick={() => removeContinuationRow(index)}>
						Удалить
					</button>
				</div>
			{/each}
		</div>
	</form>
</section>

<section class="card">
	<h3>Предпросмотр markdown</h3>
	{#if previewLines.length === 0}
		<p class="muted">Заполните упражнение и подходы, чтобы увидеть строки таблицы.</p>
	{:else}
		<pre class="preview">{previewLines.join('\n')}</pre>
	{/if}

	<div class="actions">
		<button type="button" disabled={!draft || busy} onclick={copyPreview}>Скопировать строки</button>
		<button type="button" class="secondary" disabled={!draft || busy} onclick={saveLocally}>
			Сохранить локально
		</button>
		<button type="button" class="primary" disabled={!draft || busy} onclick={saveToGitHub}>
			{busy ? 'Сохраняем...' : 'Сохранить в GitHub'}
		</button>
	</div>
</section>

<section class="card">
	<button type="button" class="ghost" onclick={() => (showToken = !showToken)}>
		{showToken ? 'Скрыть' : 'Показать'} настройки GitHub token
	</button>

	{#if showToken}
		<label class="token-field">
			<span>GitHub Personal Access Token</span>
			<input type="password" bind:value={githubToken} placeholder="github_pat_..." />
			<small class="muted">
				Нужен scope <code>repo</code> или fine-grained token с записью contents для
				<code>aaovch/gym</code>. Токен хранится только в localStorage вашего браузера.
			</small>
		</label>
	{/if}
</section>

{#if status}
	<section class="card success">{status}</section>
{/if}

{#if error}
	<section class="card error">{error}</section>
{/if}

{#if $pendingStore.length > 0}
	<section class="card">
		<h3>Локальные записи ({ $pendingStore.length })</h3>
		<p class="muted small">
			Они сразу видны на сайте в этом браузере. После сохранения в GitHub удалите их, чтобы не
			дублировать данные до следующего деплоя.
		</p>
		<ul class="pending-list">
			{#each $pendingStore as item}
				<li>
					<div>
						<strong>{item.draft.exercise}</strong>
						<div class="muted small">
							{item.draft.rows[0]?.date ? formatDateRu(item.draft.rows[0].date) : 'без даты'}
						</div>
					</div>
					<button type="button" class="ghost danger" onclick={() => pendingStore.remove(item.id)}>
						Удалить
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<section class="card muted">
	<a href={`${base}/`}>← Вернуться к плану</a>
</section>

<style>
	.toolbar {
		margin-bottom: 1rem;
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
	}

	input {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 10px;
		color: var(--text);
		padding: 0.55rem 0.75rem;
	}

	.small {
		font-size: 0.85rem;
	}

	.continuations {
		display: grid;
		gap: 0.75rem;
		padding: 1rem;
		border: 1px dashed var(--border);
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.02);
	}

	.continuations-head {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.continuation-row {
		display: grid;
		grid-template-columns: 1fr 180px auto;
		gap: 0.5rem;
	}

	.preview {
		margin: 0 0 1rem;
		padding: 1rem;
		border-radius: 12px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		overflow-x: auto;
		white-space: pre-wrap;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
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

	button.secondary {
		background: rgba(91, 157, 255, 0.12);
		border-color: rgba(91, 157, 255, 0.35);
		color: var(--accent-2);
	}

	button.ghost {
		background: transparent;
	}

	button.danger {
		color: var(--danger);
	}

	button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.token-field {
		margin-top: 1rem;
	}

	.success {
		border-color: rgba(110, 231, 168, 0.35);
		color: var(--accent);
	}

	.error {
		border-color: rgba(255, 143, 143, 0.35);
		color: var(--danger);
	}

	.pending-list {
		list-style: none;
		padding: 0;
		margin: 1rem 0 0;
		display: grid;
		gap: 0.5rem;
	}

	.pending-list li {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		align-items: center;
		padding: 0.75rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface-2);
	}

	@media (max-width: 720px) {
		.continuation-row {
			grid-template-columns: 1fr;
		}
	}
</style>
