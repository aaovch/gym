<script lang="ts">
  import { page } from '$app/state';
  import { browser } from '$app/environment';
  import { base } from '$app/paths';
  import {
    addProtocolPhase,
    createProtocolTemplate,
    duplicateProtocolTemplate,
    emptyCyclePlan,
    removeProtocolPhase,
    removeProtocolTemplate,
    resetProtocolTemplate,
    updateTemplate
  } from '$lib/cycle-plan';
  import { DEFAULT_PROTOCOL_TEMPLATE, isBundledProtocolId, isCustomProtocolId } from '$lib/protocol';
  import { saveCyclePlanState, workoutStore } from '$lib/workout-store';
  import { thesesStore } from '$lib/training-theses';

  let selectedTemplateId = $state(DEFAULT_PROTOCOL_TEMPLATE.id);

  const view = $derived(workoutStore.view);
  const plan = $derived(view.cyclePlanView.plan ?? view.cyclePlanForCalc);
  const templates = $derived(plan.templates);

  const urlTemplateId = $derived.by(() => (browser ? page.url.searchParams.get('id') : null));

  const activeTemplate = $derived(
    templates.find((item) => item.id === selectedTemplateId) ??
      templates[0] ??
      DEFAULT_PROTOCOL_TEMPLATE
  );

  const activeTemplateIsBundled = $derived(isBundledProtocolId(activeTemplate.id));
  const activeTemplateIsCustom = $derived(isCustomProtocolId(activeTemplate.id));
  const activeProtocolGuide = $derived(thesesStore.protocolGuideFor(activeTemplate.id));

  const bundledCount = $derived(templates.filter((item) => isBundledProtocolId(item.id)).length);
  const customCount = $derived(templates.filter((item) => isCustomProtocolId(item.id)).length);

  $effect(() => {
    if (!urlTemplateId || selectedTemplateId !== DEFAULT_PROTOCOL_TEMPLATE.id) return;
    if (templates.some((item) => item.id === urlTemplateId)) {
      selectedTemplateId = urlTemplateId;
    }
  });

  function ensurePlan(): boolean {
    if (workoutStore.cyclePlan) return true;
    saveCyclePlanState(emptyCyclePlan());
    return Boolean(workoutStore.cyclePlan);
  }

  function save(next: NonNullable<typeof workoutStore.cyclePlan>) {
    saveCyclePlanState(next);
  }

  function handleCreateProtocolTemplate() {
    if (!ensurePlan()) return;
    const current = workoutStore.cyclePlan!;
    const next = createProtocolTemplate(current);
    save(next);
    const created = next.templates[next.templates.length - 1];
    if (created) selectedTemplateId = created.id;
  }

  function handleDuplicateProtocolTemplate() {
    if (!ensurePlan()) return;
    const current = workoutStore.cyclePlan!;
    const next = duplicateProtocolTemplate(current, activeTemplate.id);
    save(next);
    const created = next.templates[next.templates.length - 1];
    if (created) selectedTemplateId = created.id;
  }

  function handleResetProtocolTemplate() {
    if (!ensurePlan() || !activeTemplateIsBundled) return;
    if (!confirm('Сбросить шаблон к значениям по умолчанию?')) return;
    save(resetProtocolTemplate(workoutStore.cyclePlan!, activeTemplate.id));
  }

  function handleRemoveProtocolTemplate() {
    if (!ensurePlan() || !activeTemplateIsCustom) return;
    if (!confirm('Удалить этот шаблон?')) return;
    const next = removeProtocolTemplate(workoutStore.cyclePlan!, activeTemplate.id);
    save(next);
    selectedTemplateId = next.templates[0]?.id ?? DEFAULT_PROTOCOL_TEMPLATE.id;
  }

  function handleAddProtocolPhase() {
    if (!ensurePlan()) return;
    save(addProtocolPhase(workoutStore.cyclePlan!, activeTemplate.id));
  }

  function handleRemoveProtocolPhase(index: number) {
    if (!ensurePlan()) return;
    save(removeProtocolPhase(workoutStore.cyclePlan!, activeTemplate.id, index));
  }

  function handleTemplateMeta(field: 'name' | 'description', value: string) {
    if (!ensurePlan()) return;
    save(updateTemplate(workoutStore.cyclePlan!, { ...activeTemplate, [field]: value }));
  }

  function handlePhaseChange(
    index: number,
    field: 'label' | 'intensityPct' | 'microFrom' | 'microTo',
    value: string
  ) {
    if (!ensurePlan()) return;
    const current = workoutStore.cyclePlan!;
    const phases = activeTemplate.phases.map((phase, i) => {
      if (i !== index) return phase;
      if (field === 'label') return { ...phase, label: value };
      const num = Number(value.replace(',', '.'));
      if (!Number.isFinite(num)) return phase;
      return { ...phase, [field]: num };
    });
    save(updateTemplate(current, { ...activeTemplate, phases }));
  }
</script>

<div class="container">
  <header class="page-header">
    <div>
      <div class="eyebrow">Методы силовой подготовки</div>
      <h1>Протоколы</h1>
      <p>
        Шаблоны % от 1ПМ по микроциклам. Назначаются упражнениям в
        <a href="{base}/cycles">Плане</a> — в настройках мезоцикла или в конструкторе блока.
      </p>
    </div>
    <a class="button button-ghost" href="{base}/cycles">К планированию</a>
  </header>

  <section class="metric-grid">
    <article class="metric-card">
      <span>Всего шаблонов</span>
      <strong>{templates.length}</strong>
      <small>в плане циклов</small>
    </article>
    <article class="metric-card">
      <span>Базовые</span>
      <strong>{bundledCount}</strong>
      <small>встроенные методы</small>
    </article>
    <article class="metric-card">
      <span>Свои</span>
      <strong>{customCount}</strong>
      <small>созданные вручную</small>
    </article>
    <article class="metric-card">
      <span>Фаз в шаблоне</span>
      <strong>{activeTemplate.phases.length}</strong>
      <small>μ-диапазоны и %1ПМ</small>
    </article>
  </section>

  <section class="card editor card-pad">
    <div class="editor-head">
      <div>
        <h2>Редактор шаблона</h2>
        <p class="muted">
          Каждая фаза задаёт диапазон микроциклов (μ) и целевой процент от якорного 1ПМ.
        </p>
      </div>
    </div>

    <div class="editor-toolbar">
      <label>
        Шаблон
        <select bind:value={selectedTemplateId} class="field-select">
          {#each templates as tpl (tpl.id)}
            <option value={tpl.id}>{tpl.name}</option>
          {/each}
        </select>
      </label>
      <button type="button" class="button button-secondary" onclick={handleCreateProtocolTemplate}>
        + Новый
      </button>
      <button type="button" class="button button-secondary" onclick={handleDuplicateProtocolTemplate}>
        Дублировать
      </button>
      {#if activeTemplateIsBundled}
        <button type="button" class="button button-secondary" onclick={handleResetProtocolTemplate}>
          Сбросить
        </button>
      {/if}
      {#if activeTemplateIsCustom}
        <button type="button" class="button button-danger" onclick={handleRemoveProtocolTemplate}>
          Удалить
        </button>
      {/if}
    </div>

    <div class="protocol-meta">
      <label>
        Название
        <input
          class="field-input"
          value={activeTemplate.name}
          disabled={activeTemplateIsBundled}
          onchange={(e) => handleTemplateMeta('name', e.currentTarget.value)}
        />
      </label>
      <label class="protocol-description-field">
        Описание
        <textarea
          class="field-input"
          rows="2"
          value={activeTemplate.description ?? ''}
          onchange={(e) => handleTemplateMeta('description', e.currentTarget.value)}
        ></textarea>
      </label>
    </div>

    {#if activeProtocolGuide}
      <div class="protocol-guide">
        {#if activeProtocolGuide.example}
          <p><strong>Пример:</strong> {activeProtocolGuide.example}</p>
        {/if}
        {#if activeProtocolGuide.recommendations?.length}
          <ul class="protocol-guide-list">
            {#each activeProtocolGuide.recommendations as item}
              <li>{item}</li>
            {/each}
          </ul>
        {/if}
        {#if activeProtocolGuide.weeks?.length}
          <div class="matrix-wrap">
            <table class="matrix">
              <thead>
                <tr>
                  <th></th>
                  {#each activeProtocolGuide.weeks as week (week.id)}
                    <th>{week.weekLabel}</th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                {#if activeProtocolGuide.weeks.some((week) => week.loadLabel)}
                  <tr>
                    <th scope="row">Нагрузка</th>
                    {#each activeProtocolGuide.weeks as week (week.id)}
                      <td>{week.loadLabel}</td>
                    {/each}
                  </tr>
                {/if}
                <tr>
                  <th scope="row">{activeProtocolGuide.primaryRowLabel ?? 'Основное упражнение'}</th>
                  {#each activeProtocolGuide.weeks as week (week.id)}
                    <td>{week.prescription}</td>
                  {/each}
                </tr>
                {#if activeProtocolGuide.weeks.some((week) => week.accessoryPrescription != null)}
                  <tr>
                    <th scope="row">{activeProtocolGuide.accessoryRowLabel ?? 'Дополнительное упражнение'}</th>
                    {#each activeProtocolGuide.weeks as week (week.id)}
                      <td>{week.accessoryPrescription ?? '—'}</td>
                    {/each}
                  </tr>
                {/if}
                {#if activeProtocolGuide.weeks.some((week) => week.goal)}
                  <tr>
                    <th scope="row">Цель</th>
                    {#each activeProtocolGuide.weeks as week (week.id)}
                      <td>{week.goal ?? '—'}</td>
                    {/each}
                  </tr>
                {/if}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    {/if}

    <div class="phase-grid">
      {#each activeTemplate.phases as phase, index}
        <article class="phase-card">
          <input
            class="field-input"
            type="text"
            value={phase.label}
            onchange={(e) => handlePhaseChange(index, 'label', e.currentTarget.value)}
          />
          <label>
            <span>%1ПМ</span>
            <input
              class="field-input"
              type="number"
              step="2.5"
              value={phase.intensityPct}
              onchange={(e) => handlePhaseChange(index, 'intensityPct', e.currentTarget.value)}
            />
          </label>
          <label>
            <span>μ</span>
            <input
              class="field-input narrow"
              type="number"
              value={phase.microFrom}
              onchange={(e) => handlePhaseChange(index, 'microFrom', e.currentTarget.value)}
            />
            <span>—</span>
            <input
              class="field-input narrow"
              type="number"
              value={phase.microTo}
              onchange={(e) => handlePhaseChange(index, 'microTo', e.currentTarget.value)}
            />
          </label>
          {#if activeTemplate.phases.length > 1}
            <button
              type="button"
              class="button button-danger phase-remove"
              onclick={() => handleRemoveProtocolPhase(index)}
            >
              ×
            </button>
          {/if}
        </article>
      {/each}
    </div>
    <button type="button" class="button button-secondary" onclick={handleAddProtocolPhase}>
      + Фаза (μ)
    </button>
  </section>

  <section class="section-heading">
    <div>
      <h2>Все шаблоны</h2>
      <p>Краткий обзор методов, доступных при планировании мезоциклов.</p>
    </div>
  </section>

  <section class="catalog-grid">
    {#each templates as template (template.id)}
      <article class="card catalog-card" class:active={template.id === selectedTemplateId}>
        <button
          type="button"
          class="catalog-select"
          onclick={() => (selectedTemplateId = template.id)}
        >
          <strong>{template.name}</strong>
          {#if template.description}
            <p class="muted">{template.description}</p>
          {/if}
          <div class="phase-chips">
            {#each template.phases as phase (phase.id)}
              <span class="phase-chip">
                μ{phase.microFrom}–{phase.microTo}: {phase.intensityPct}%
              </span>
            {/each}
          </div>
        </button>
      </article>
    {/each}
  </section>
</div>

<style>
  .editor-head h2 {
    margin: 0 0 6px;
    font-size: 20px;
  }

  .editor-head p {
    margin: 0;
    max-width: 640px;
    line-height: 1.5;
  }

  .editor-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 9px;
    align-items: flex-end;
    margin: 18px 0 14px;
  }

  .editor-toolbar label {
    min-width: min(260px, 100%);
  }

  .protocol-meta {
    display: grid;
    gap: 12px;
    margin-bottom: 14px;
  }

  .protocol-description-field textarea {
    resize: vertical;
    min-height: 3rem;
  }

  .protocol-guide {
    margin-bottom: 14px;
    padding: 12px 0;
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    font-size: 13px;
    line-height: 1.45;
  }

  .protocol-guide p {
    margin: 0 0 10px;
  }

  .protocol-guide-list {
    margin: 0 0 10px;
    padding-left: 1.1rem;
    display: grid;
    gap: 4px;
  }

  .matrix-wrap {
    overflow: auto;
    margin-top: 8px;
  }

  .matrix {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .matrix th,
  .matrix td {
    padding: 8px 10px;
    border: 1px solid var(--line);
    text-align: left;
    vertical-align: top;
  }

  .matrix thead th {
    color: var(--muted);
    font-size: 11px;
  }

  .matrix tbody th {
    color: var(--muted-strong);
    font-weight: 650;
    white-space: nowrap;
  }

  .phase-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
    margin: 14px 0;
  }

  .phase-card {
    position: relative;
    display: grid;
    gap: 8px;
    padding: 12px;
    background: var(--surface-raised);
    border: 1px solid var(--line);
  }

  .phase-card label {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--muted);
  }

  .field-input.narrow {
    width: 4.5rem;
  }

  .phase-remove {
    justify-self: end;
    min-width: 2rem;
    padding-inline: 0.5rem;
  }

  .catalog-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 12px;
  }

  .catalog-card {
    overflow: hidden;
  }

  .catalog-card.active {
    border-color: rgb(185 243 90 / 35%);
    box-shadow: 0 0 0 1px rgb(185 243 90 / 12%);
  }

  .catalog-select {
    width: 100%;
    padding: 16px;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .catalog-select strong {
    display: block;
    font-size: 15px;
  }

  .catalog-select p {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.45;
  }

  .phase-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 10px;
  }

  .phase-chip {
    padding: 2px 7px;
    color: var(--muted-strong);
    background: var(--surface-raised);
    border: 1px solid var(--line);
    font-size: 11px;
  }
</style>
