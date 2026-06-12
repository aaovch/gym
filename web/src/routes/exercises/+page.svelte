<script lang="ts">
  import { page } from '$app/state';
  import { browser } from '$app/environment';
  import { base } from '$app/paths';
  import {
    EXERCISE_KIND_LABELS,
    createExercise,
    exerciseKindFromName,
    uniqueExerciseId,
    validateExercise
  } from '$lib/exercises';
  import { MOVEMENT_BLOCKS, type MovementBlockId } from '$lib/muscle-groups';
  import { deleteExercise, saveExercise, workoutStore } from '$lib/workout-store';
  import type { Exercise, ExerciseKind } from '$lib/types';

  type KindFilter = 'all' | ExerciseKind;

  let query = $state('');
  let kindFilter = $state<KindFilter>('all');
  let selectedId = $state<string | null>(null);
  let isNew = $state(false);

  let formName = $state('');
  let formKind = $state<ExerciseKind>('strength');
  let formBlocks = $state<MovementBlockId[]>([]);
  let formError = $state('');
  let formStatus = $state('');
  let confirmDelete = $state(false);

  const view = $derived(workoutStore.view);
  const urlId = $derived.by(() => (browser ? page.url.searchParams.get('id') : null));

  const logCounts = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const log of view.logs) {
      counts.set(log.exerciseId, (counts.get(log.exerciseId) ?? 0) + 1);
    }
    return counts;
  });

  const filteredExercises = $derived(
    view.exercises
      .filter((exercise) => {
        if (kindFilter !== 'all' && exercise.kind !== kindFilter) return false;
        const q = query.trim().toLowerCase();
        if (!q) return true;
        return (
          exercise.name.toLowerCase().includes(q) ||
          exercise.id.toLowerCase().includes(q) ||
          exercise.movementBlocks.some((block) =>
            MOVEMENT_BLOCKS.find((item) => item.id === block)?.label.toLowerCase().includes(q)
          )
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  );

  const selectedExercise = $derived(
    selectedId ? view.exercises.find((item) => item.id === selectedId) ?? null : null
  );

  const formId = $derived(
    isNew ? uniqueExerciseId(formName.trim() || 'exercise', view.exercises) : selectedId ?? ''
  );

  const selectedLogCount = $derived(selectedId ? logCounts.get(selectedId) ?? 0 : 0);

  const kindCounts = $derived({
    strength: view.exercises.filter((item) => item.kind === 'strength').length,
    run: view.exercises.filter((item) => item.kind === 'run').length,
    jumps: view.exercises.filter((item) => item.kind === 'jumps').length
  });

  $effect(() => {
    if (urlId && !selectedId && !isNew) {
      const exists = view.exercises.some((item) => item.id === urlId);
      if (exists) selectExercise(urlId);
    }
  });

  function resetForm() {
    formName = '';
    formKind = 'strength';
    formBlocks = [];
    formError = '';
    formStatus = '';
    confirmDelete = false;
  }

  function selectExercise(id: string) {
    const exercise = view.exercises.find((item) => item.id === id);
    if (!exercise) return;
    isNew = false;
    selectedId = id;
    formName = exercise.name;
    formKind = exercise.kind;
    formBlocks = [...exercise.movementBlocks];
    formError = '';
    formStatus = '';
    confirmDelete = false;
  }

  function startNew() {
    isNew = true;
    selectedId = null;
    resetForm();
  }

  function toggleBlock(blockId: MovementBlockId) {
    formBlocks = formBlocks.includes(blockId)
      ? formBlocks.filter((item) => item !== blockId)
      : [...formBlocks, blockId];
  }

  function applyKindFromName() {
    const name = formName.trim();
    if (!name) return;
    formKind = exerciseKindFromName(name);
    if (!formBlocks.length) {
      const created = createExercise(name);
      formBlocks = [...created.movementBlocks];
    }
  }

  function saveForm() {
    formError = '';
    formStatus = '';

    const exercise: Exercise = {
      id: formId,
      name: formName.trim(),
      kind: formKind,
      movementBlocks: formBlocks
    };

    const validationError = validateExercise(exercise, view.exercises, isNew ? undefined : selectedId ?? undefined);
    if (validationError) {
      formError = validationError;
      return;
    }

    try {
      saveExercise(exercise);
      formStatus = isNew ? 'Упражнение добавлено' : 'Изменения сохранены';
      isNew = false;
      selectedId = exercise.id;
    } catch (error) {
      formError = error instanceof Error ? error.message : 'Не удалось сохранить';
    }
  }

  function removeExercise() {
    if (!selectedId) return;
    formError = '';
    formStatus = '';

    try {
      deleteExercise(selectedId);
      selectedId = null;
      isNew = false;
      resetForm();
    } catch (error) {
      formError = error instanceof Error ? error.message : 'Не удалось удалить';
      confirmDelete = false;
    }
  }

  function blockLabel(id: MovementBlockId): string {
    return MOVEMENT_BLOCKS.find((item) => item.id === id)?.shortLabel ?? id;
  }
</script>

<div class="container">
  <header class="page-header">
    <div>
      <div class="eyebrow">Справочник движений</div>
      <h1>Упражнения</h1>
      <p>
        Каталог всех упражнений: тип нагрузки, блоки движения и стабильный id для журнала и плана.
        Id не меняется — можно переименовать упражнение без потери истории.
      </p>
    </div>
    <button class="button button-primary" type="button" onclick={startNew}>Новое упражнение</button>
  </header>

  <section class="metric-grid">
    <article class="metric-card">
      <span>Всего в каталоге</span>
      <strong>{view.exercises.length}</strong>
      <small>упражнений</small>
    </article>
    <article class="metric-card">
      <span>Силовые</span>
      <strong>{kindCounts.strength}</strong>
      <small>с весом и повторами</small>
    </article>
    <article class="metric-card">
      <span>Кардио</span>
      <strong>{kindCounts.run}</strong>
      <small>бег и выносливость</small>
    </article>
    <article class="metric-card">
      <span>Прыжки</span>
      <strong>{kindCounts.jumps}</strong>
      <small>взрывная работа</small>
    </article>
  </section>

  <div class="exercises-layout">
    <section class="card list-panel">
      <div class="list-toolbar card-pad">
        <label>
          Поиск
          <input bind:value={query} placeholder="Название, id или блок движения" />
        </label>
        <label>
          Тип
          <select bind:value={kindFilter}>
            <option value="all">Все типы</option>
            <option value="strength">Силовые</option>
            <option value="run">Кардио</option>
            <option value="jumps">Прыжки</option>
          </select>
        </label>
      </div>

      {#if filteredExercises.length === 0}
        <div class="empty-state card-pad">
          <p>Ничего не найдено. Попробуйте другой фильтр или добавьте новое упражнение.</p>
        </div>
      {:else}
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Название</th>
                <th>Тип</th>
                <th>Блоки</th>
                <th>Записи</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredExercises as exercise (exercise.id)}
                <tr
                  class:selected={selectedId === exercise.id && !isNew}
                  onclick={() => selectExercise(exercise.id)}
                >
                  <td>
                    <strong>{exercise.name}</strong>
                    <small class="exercise-id">{exercise.id}</small>
                  </td>
                  <td>{EXERCISE_KIND_LABELS[exercise.kind]}</td>
                  <td>
                    {#if exercise.movementBlocks.length}
                      <span class="block-tags">
                        {#each exercise.movementBlocks as block (block)}
                          <span class="block-tag">{blockLabel(block)}</span>
                        {/each}
                      </span>
                    {:else}
                      <span class="muted-text">—</span>
                    {/if}
                  </td>
                  <td>{logCounts.get(exercise.id) ?? 0}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    <section class="card editor-panel">
      <div class="card-pad">
        {#if !selectedExercise && !isNew}
          <div class="editor-empty">
            <h2>Выберите упражнение</h2>
            <p>Нажмите на строку в списке или создайте новое упражнение.</p>
          </div>
        {:else}
          <div class="editor-heading">
            <div>
              <div class="eyebrow">{isNew ? 'Новое' : 'Редактирование'}</div>
              <h2>{isNew ? 'Добавить упражнение' : selectedExercise?.name}</h2>
            </div>
            {#if !isNew && selectedId}
              <a class="button button-ghost" href="{base}/history?exercise={encodeURIComponent(formName)}">
                История
              </a>
            {/if}
          </div>

          <div class="editor-form">
            <label>
              Название
              <input
                bind:value={formName}
                placeholder="Например, Приседания со штангой"
                onblur={applyKindFromName}
              />
            </label>

            <div class="field-row">
              <label>
                Тип нагрузки
                <select bind:value={formKind}>
                  <option value="strength">Силовое</option>
                  <option value="run">Кардио</option>
                  <option value="jumps">Прыжки</option>
                </select>
              </label>
              <label>
                Id (стабильный ключ)
                <input value={formId} readonly />
              </label>
            </div>

            <fieldset class="blocks-fieldset">
              <legend>Блоки движения</legend>
              <p class="blocks-hint">Для карты нагрузки и группировки в аналитике. Можно выбрать несколько.</p>
              <div class="blocks-grid">
                {#each MOVEMENT_BLOCKS as block (block.id)}
                  <label class="block-check">
                    <input
                      type="checkbox"
                      checked={formBlocks.includes(block.id)}
                      onchange={() => toggleBlock(block.id)}
                    />
                    <span>
                      <strong>{block.label}</strong>
                      <small>{block.description}</small>
                    </span>
                  </label>
                {/each}
              </div>
            </fieldset>

            {#if !isNew && selectedId}
              <div class="editor-meta">
                <span>Записей в журнале: <b>{selectedLogCount}</b></span>
                {#if selectedLogCount > 0}
                  <a href="{base}/history?exercise={encodeURIComponent(formName)}">Открыть журнал</a>
                {/if}
              </div>
            {/if}

            {#if formError}
              <div class="sync-status error" role="alert">{formError}</div>
            {/if}
            {#if formStatus}
              <div class="sync-status ok" role="status">{formStatus}</div>
            {/if}

            <div class="editor-actions">
              {#if !isNew && selectedId}
                {#if confirmDelete}
                  <button class="button button-danger" type="button" onclick={removeExercise}>
                    Подтвердить удаление
                  </button>
                  <button
                    class="button button-ghost"
                    type="button"
                    onclick={() => (confirmDelete = false)}
                  >
                    Отмена
                  </button>
                {:else}
                  <button
                    class="button button-danger"
                    type="button"
                    disabled={selectedLogCount > 0}
                    title={selectedLogCount > 0
                      ? 'Сначала удалите записи в журнале'
                      : 'Удалить упражнение из каталога'}
                    onclick={() => (confirmDelete = true)}
                  >
                    Удалить
                  </button>
                {/if}
              {/if}
              <button class="button button-primary" type="button" onclick={saveForm}>
                {isNew ? 'Добавить' : 'Сохранить'}
              </button>
            </div>
          </div>
        {/if}
      </div>
    </section>
  </div>
</div>

<style>
  .exercises-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.9fr);
    gap: 16px;
    margin-top: 22px;
  }

  .list-toolbar {
    display: grid;
    grid-template-columns: 1fr 180px;
    gap: 12px;
    padding-bottom: 0;
    border-bottom: 1px solid var(--line);
  }

  .table-wrap {
    overflow: auto;
  }

  tbody tr {
    cursor: pointer;
    transition: background 120ms ease;
  }

  tbody tr:hover,
  tbody tr.selected {
    background: rgb(185 243 90 / 6%);
  }

  tbody tr.selected td:first-child strong {
    color: var(--accent);
  }

  .exercise-id {
    display: block;
    margin-top: 3px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 500;
  }

  .block-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .block-tag {
    padding: 2px 7px;
    color: var(--muted-strong);
    background: var(--surface-raised);
    border: 1px solid var(--line);
    border-radius: 0;
    font-size: 11px;
  }

  .muted-text {
    color: var(--muted);
  }

  .editor-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 18px;
  }

  .editor-heading h2 {
    margin: 4px 0 0;
    font-size: 22px;
  }

  .editor-empty h2 {
    margin: 0 0 8px;
    font-size: 20px;
  }

  .editor-empty p,
  .empty-state p {
    margin: 0;
    color: var(--muted);
    line-height: 1.55;
  }

  .editor-form {
    display: grid;
    gap: 14px;
  }

  .blocks-fieldset {
    margin: 0;
    padding: 14px;
    border: 1px solid var(--line);
    border-radius: 0;
  }

  .blocks-fieldset legend {
    padding: 0 4px;
    color: var(--muted-strong);
    font-size: 13px;
    font-weight: 650;
  }

  .blocks-hint {
    margin: 0 0 12px;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.45;
  }

  .blocks-grid {
    display: grid;
    gap: 8px;
  }

  .block-check {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 10px;
    align-items: start;
    padding: 10px;
    background: var(--surface-raised);
    border: 1px solid var(--line);
    border-radius: 0;
    cursor: pointer;
    font-weight: 500;
  }

  .block-check strong {
    display: block;
    color: var(--text);
    font-size: 13px;
  }

  .block-check small {
    display: block;
    margin-top: 2px;
    color: var(--muted);
    font-size: 11px;
    line-height: 1.4;
    font-weight: 400;
  }

  .editor-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 16px;
    align-items: center;
    color: var(--muted);
    font-size: 12px;
  }

  .editor-meta a {
    color: var(--accent);
    font-weight: 650;
  }

  .editor-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 9px;
    margin-top: 4px;
  }

  @media (max-width: 980px) {
    .exercises-layout {
      grid-template-columns: 1fr;
    }

    .list-toolbar {
      grid-template-columns: 1fr;
    }
  }
</style>
