<script lang="ts">
	import { emptySetInput } from '$lib/database';
	import type { RowInput } from '$lib/types';

	let {
		row = $bindable(),
		label = 'Подходы',
		onremove = undefined
	}: {
		row: RowInput;
		label?: string;
		onremove?: (() => void) | undefined;
	} = $props();

	function addSet() {
		row.sets = [...row.sets, emptySetInput()];
	}

	function removeSet(index: number) {
		row.sets = row.sets.filter((_, i) => i !== index);
		if (row.sets.length === 0) row.sets = [emptySetInput()];
	}
</script>

<div class="row-block">
	<div class="row-head">
		<strong>{label}</strong>
		<div class="row-actions">
			<button type="button" class="ghost" onclick={addSet}>+ подход</button>
			{#if onremove}
				<button type="button" class="ghost danger" onclick={onremove}>Удалить блок</button>
			{/if}
		</div>
	</div>

	<div class="sets-grid">
		{#each row.sets as set, index (index)}
			<div class="set-item">
				<label>
					<span>Вес</span>
					<input bind:value={set.weight} inputmode="decimal" placeholder="100" />
				</label>
				<label>
					<span>Повт</span>
					<input bind:value={set.reps} inputmode="numeric" placeholder="5" />
				</label>
				<button type="button" class="ghost danger" onclick={() => removeSet(index)} aria-label="Удалить подход">
					×
				</button>
			</div>
		{/each}
	</div>

	<label>
		<span>Комментарий</span>
		<input bind:value={row.comment} placeholder="все кластерно" />
	</label>
</div>

<style>
	.row-block {
		display: grid;
		gap: 0.75rem;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface-2);
	}

	.row-head {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.row-actions {
		display: flex;
		gap: 0.35rem;
		flex-wrap: wrap;
	}

	.sets-grid {
		display: grid;
		gap: 0.5rem;
	}

	.set-item {
		display: grid;
		grid-template-columns: 1fr 1fr auto;
		gap: 0.5rem;
		align-items: end;
	}

	label {
		display: grid;
		gap: 0.25rem;
		font-size: 0.85rem;
		color: var(--muted);
	}

	input {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		color: var(--text);
		padding: 0.55rem 0.75rem;
	}

	button.ghost {
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 10px;
		color: var(--text);
		padding: 0.45rem 0.65rem;
	}

	button.danger {
		color: var(--danger);
	}
</style>
