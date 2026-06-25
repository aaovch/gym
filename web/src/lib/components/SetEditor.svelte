<script lang="ts">
  import { tick } from 'svelte';
  import { emptySetInput } from '$lib/database';
  import type { ExerciseKind, RowInput } from '$lib/types';

  let {
    row = $bindable(),
    label = 'Подходы',
    kind = 'strength',
    onremove = undefined
  }: {
    row: RowInput;
    label?: string;
    kind?: ExerciseKind;
    onremove?: (() => void) | undefined;
  } = $props();

  const firstLabel = $derived(kind === 'run' ? 'Время, мин' : kind === 'jumps' ? 'Подходов' : 'Вес, кг');
  const secondLabel = $derived(kind === 'run' ? 'Скорость, км/ч' : kind === 'jumps' ? 'Повторов' : 'Повт');
  const firstPlaceholder = $derived(kind === 'run' ? '20' : kind === 'jumps' ? '10' : '100');
  const secondPlaceholder = $derived(kind === 'run' ? '8,5' : kind === 'jumps' ? '5' : '5');

  function addSet() {
    row.sets = [...row.sets, emptySetInput()];
  }

  function removeSet(index: number) {
    row.sets = row.sets.filter((_, i) => i !== index);
    if (row.sets.length === 0) row.sets = [emptySetInput()];
  }

  // Enter advances through fields instead of submitting the form, so logging a
  // set is a steady weight → reps → next-set rhythm without reaching for the mouse.
  async function onFieldKey(event: KeyboardEvent, field: 'first' | 'second', index: number) {
    if (event.key !== 'Enter' || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const input = event.currentTarget as HTMLInputElement;
    const item = input.closest('.set-item');
    if (field === 'first') {
      const second = item?.querySelectorAll('input')[1] as HTMLInputElement | undefined;
      second?.focus();
      second?.select();
      return;
    }
    if (index === row.sets.length - 1) {
      addSet();
      await tick();
      const items = input.closest('.sets-grid')?.querySelectorAll('.set-item');
      const lastFirst = items?.[items.length - 1]?.querySelector('input') as HTMLInputElement | undefined;
      lastFirst?.focus();
    } else {
      const next = item?.nextElementSibling?.querySelector('input') as HTMLInputElement | undefined;
      next?.focus();
      next?.select();
    }
  }
</script>

<div class="row-block">
	<div class="row-head">
		<strong>{label}</strong>
		<div class="row-actions">
			<button type="button" class="button button-ghost button-sm" onclick={addSet}>+ подход</button>
			{#if onremove}
				<button type="button" class="button button-ghost button-danger button-sm" onclick={onremove}>Удалить блок</button>
			{/if}
		</div>
	</div>

	<div class="sets-grid">
		{#each row.sets as set, index (set.id)}
      <div class="set-item">
        <span class="set-no" aria-hidden="true">{index + 1}</span>
        <label>
          <span>{firstLabel}</span>
          <input
            bind:value={set.weight}
            inputmode="decimal"
            placeholder={firstPlaceholder}
            onkeydown={(event) => onFieldKey(event, 'first', index)}
          />
        </label>
        <label>
          <span>{secondLabel}</span>
          <input
            bind:value={set.reps}
            inputmode="decimal"
            placeholder={secondPlaceholder}
            onkeydown={(event) => onFieldKey(event, 'second', index)}
          />
        </label>
        <button type="button" class="button button-ghost button-danger set-remove" onclick={() => removeSet(index)} aria-label="Удалить подход">
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
		border-radius: 0;
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
    grid-template-columns: 1.75rem 1fr 1fr auto;
    gap: 0.5rem;
    align-items: end;
  }

  .set-no {
    display: grid;
    place-items: center;
    height: 46px;
    color: var(--muted);
    background: #0a0c10;
    border: 1px solid var(--line);
    font-family: var(--font-mono);
    font-size: 0.78rem;
    font-weight: 700;
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
    border-radius: 0;
    color: var(--text);
    min-height: 46px;
    padding: 0.6rem 0.75rem;
    font-size: 16px;
  }

  .set-remove {
    min-height: 46px;
    min-width: 46px;
    padding: 0;
  }
</style>
