<script lang="ts">
  import { page } from '$app/state';
  import { browser } from '$app/environment';
  import { base } from '$app/paths';
  import {
    addProtocolPhase,
    createProtocolTemplate,
    duplicateProtocolTemplate,
    emptyCyclePlan,
    phaseForMicro,
    removeProtocolPhase,
    removeProtocolTemplate,
    resetProtocolTemplate,
    targetWeight,
    updateTemplate,
    type MesocyclePlan,
    type ProtocolTemplate
  } from '$lib/cycle-plan';
  import {
    DEFAULT_PROTOCOL_TEMPLATE,
    best1rmAllTime,
    isBundledProtocolId,
    isCustomProtocolId,
    newStepId,
    type ProtocolPhase,
    type ProtocolSetStep
  } from '$lib/protocol';
  import { fmtNum } from '$lib/format';
  import { saveCyclePlanState, workoutStore } from '$lib/workout-store';
  import { thesesStore } from '$lib/training-theses';

  type Tab = 'overview' | 'editor' | 'usage';

  let selectedTemplateId = $state(DEFAULT_PROTOCOL_TEMPLATE.id);
  let tab = $state<Tab>('overview');
  let search = $state('');
  let previewExercise = $state('');
  let previewAnchorInput = $state('');

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

  const bundledTemplates = $derived(templates.filter((item) => isBundledProtocolId(item.id)));
  const customTemplates = $derived(templates.filter((item) => isCustomProtocolId(item.id)));

  const exerciseNameById = $derived(new Map(view.exercises.map((ex) => [ex.id, ex.name])));
  const strengthExercises = $derived(
    view.exercises.filter((ex) => ex.kind === 'strength').map((ex) => ex.name)
  );

  function matchesSearch(tpl: ProtocolTemplate): boolean {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      tpl.name.toLowerCase().includes(q) ||
      (tpl.description ?? '').toLowerCase().includes(q)
    );
  }

  const filteredBundled = $derived(bundledTemplates.filter(matchesSearch));
  const filteredCustom = $derived(customTemplates.filter(matchesSearch));

  function maxMicroOf(tpl: ProtocolTemplate): number {
    return Math.min(12, Math.max(1, ...tpl.phases.map((p) => p.microTo)));
  }

  type IntensityPoint = { micro: number; pct: number; label: string | null };

  function intensityPoints(tpl: ProtocolTemplate): IntensityPoint[] {
    const max = maxMicroOf(tpl);
    const points: IntensityPoint[] = [];
    for (let micro = 1; micro <= max; micro += 1) {
      const phase = phaseForMicro(tpl, micro);
      points.push({ micro, pct: phase?.intensityPct ?? 0, label: phase?.label ?? null });
    }
    return points;
  }

  function peakPct(tpl: ProtocolTemplate): number {
    return Math.max(0, ...tpl.phases.map((p) => p.intensityPct));
  }

  // высота столбика спарклайна/кривой в % от высоты контейнера
  function barHeight(pct: number, scaleMax: number): number {
    if (scaleMax <= 0) return 0;
    return Math.round((pct / scaleMax) * 100);
  }

  function usageCount(templateId: string): number {
    let count = 0;
    for (const meso of plan.mesocycles) {
      if (meso.templateId === templateId) count += 1;
      for (const proto of Object.values(meso.exerciseProtocols ?? {})) {
        if (proto === templateId) count += 1;
      }
    }
    return count;
  }

  type MesoUsage = { meso: MesocyclePlan; asDefault: boolean; exercises: string[] };

  const activeUsage = $derived.by((): MesoUsage[] => {
    const rows: MesoUsage[] = [];
    for (const meso of plan.mesocycles) {
      const asDefault = meso.templateId === activeTemplate.id;
      const exercises: string[] = [];
      for (const [exerciseId, proto] of Object.entries(meso.exerciseProtocols ?? {})) {
        if (proto === activeTemplate.id) {
          exercises.push(exerciseNameById.get(exerciseId) ?? exerciseId);
        }
      }
      if (asDefault || exercises.length) {
        rows.push({ meso, asDefault, exercises: exercises.sort((a, b) => a.localeCompare(b, 'ru')) });
      }
    }
    return rows;
  });

  const coverageIssues = $derived.by((): string[] => {
    const issues: string[] = [];
    const sorted = [...activeTemplate.phases].sort((a, b) => a.microFrom - b.microFrom);
    for (const phase of sorted) {
      if (phase.microTo < phase.microFrom) {
        issues.push(`Фаза «${phase.label || '—'}»: конец μ меньше начала.`);
      }
    }
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (cur.microFrom <= prev.microTo) {
        issues.push(`Нахлёст μ между «${prev.label || '—'}» и «${cur.label || '—'}».`);
      } else if (cur.microFrom > prev.microTo + 1) {
        issues.push(`Пропуск μ ${prev.microTo + 1}–${cur.microFrom - 1} перед «${cur.label || '—'}».`);
      }
    }
    return issues;
  });

  const previewAnchor = $derived.by((): number | null => {
    const manual = Number(previewAnchorInput.replace(',', '.'));
    if (Number.isFinite(manual) && manual > 0) return manual;
    if (previewExercise) return best1rmAllTime(view.entries, previewExercise)?.value ?? null;
    return null;
  });

  const previewRows = $derived.by(() => {
    return intensityPoints(activeTemplate).map((point) => ({
      ...point,
      weight: previewAnchor && point.pct ? targetWeight(previewAnchor, point.pct) : null,
      breakdown: schemeBreakdown(point.micro)
    }));
  });

  const hasScheme = $derived(activeTemplate.phases.some((p) => p.scheme?.length));

  const curvePoints = $derived(intensityPoints(activeTemplate));
  const curveScale = $derived(Math.max(peakPct(activeTemplate), 100));

  $effect(() => {
    if (!urlTemplateId || selectedTemplateId !== DEFAULT_PROTOCOL_TEMPLATE.id) return;
    if (templates.some((item) => item.id === urlTemplateId)) {
      selectedTemplateId = urlTemplateId;
    }
  });

  // дефолтное упражнение для блока «в килограммах» — первое с историей
  $effect(() => {
    if (previewExercise || !strengthExercises.length) return;
    const withHistory = strengthExercises.find((name) => best1rmAllTime(view.entries, name));
    previewExercise = withHistory ?? strengthExercises[0];
  });

  function selectTemplate(id: string) {
    selectedTemplateId = id;
  }

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
    const next = createProtocolTemplate(workoutStore.cyclePlan!);
    save(next);
    const created = next.templates[next.templates.length - 1];
    if (created) {
      selectedTemplateId = created.id;
      tab = 'editor';
    }
  }

  function handleDuplicateProtocolTemplate() {
    if (!ensurePlan()) return;
    const next = duplicateProtocolTemplate(workoutStore.cyclePlan!, activeTemplate.id);
    save(next);
    const created = next.templates[next.templates.length - 1];
    if (created) {
      selectedTemplateId = created.id;
      tab = 'editor';
    }
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
    tab = 'overview';
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

  function commitPhases(phases: ProtocolPhase[]) {
    if (!ensurePlan()) return;
    save(updateTemplate(workoutStore.cyclePlan!, { ...activeTemplate, phases }));
  }

  // Изменение раскладки фазы + синхронизация «рабочей» интенсивности (верхняя ступень).
  function withScheme(phaseIndex: number, mutate: (scheme: ProtocolSetStep[]) => ProtocolSetStep[]) {
    const phases = activeTemplate.phases.map((phase, i) => {
      if (i !== phaseIndex) return phase;
      const scheme = mutate([...(phase.scheme ?? [])]);
      const top = scheme.length ? Math.max(...scheme.map((s) => s.intensityPct)) : phase.intensityPct;
      return { ...phase, scheme, intensityPct: top || phase.intensityPct };
    });
    commitPhases(phases);
  }

  function handleDetailPhase(phaseIndex: number) {
    const base = activeTemplate.phases[phaseIndex]?.intensityPct || 75;
    withScheme(phaseIndex, () => [{ id: newStepId(), sets: 5, reps: 5, intensityPct: base }]);
  }

  function handleClearScheme(phaseIndex: number) {
    const phases = activeTemplate.phases.map((phase, i) => {
      if (i !== phaseIndex) return phase;
      const next = { ...phase };
      delete next.scheme;
      return next;
    });
    commitPhases(phases);
  }

  function handleAddStep(phaseIndex: number) {
    withScheme(phaseIndex, (scheme) => {
      const last = scheme[scheme.length - 1];
      return [
        ...scheme,
        {
          id: newStepId(),
          sets: last?.sets ?? 1,
          reps: last?.reps ?? 5,
          intensityPct: last?.intensityPct ?? 75
        }
      ];
    });
  }

  function handleRemoveStep(phaseIndex: number, stepIndex: number) {
    withScheme(phaseIndex, (scheme) => scheme.filter((_, i) => i !== stepIndex));
  }

  function handleStepChange(
    phaseIndex: number,
    stepIndex: number,
    field: 'sets' | 'reps' | 'intensityPct' | 'note',
    value: string
  ) {
    withScheme(phaseIndex, (scheme) =>
      scheme.map((step, i) => {
        if (i !== stepIndex) return step;
        if (field === 'note') return { ...step, note: value };
        const num = Number(value.replace(',', '.'));
        if (!Number.isFinite(num)) return step;
        return { ...step, [field]: num };
      })
    );
  }

  type SchemeStepView = { id: string; label: string; weight: number | null; pct: number; note?: string };

  function schemeBreakdown(micro: number): SchemeStepView[] | null {
    const phase = phaseForMicro(activeTemplate, micro);
    if (!phase?.scheme?.length) return null;
    return phase.scheme.map((step) => ({
      id: step.id,
      label: `${step.sets}×${step.reps}`,
      pct: step.intensityPct,
      weight: previewAnchor && step.intensityPct ? targetWeight(previewAnchor, step.intensityPct) : null,
      note: step.note
    }));
  }
</script>

<div class="container">
  <header class="page-header">
    <div>
      <div class="eyebrow">Методы силовой подготовки</div>
      <h1>Протоколы</h1>
      <p>
        Шаблоны % от 1ПМ по микроциклам. Назначаются упражнениям в
        <a href="{base}/cycles">Плане</a>.
      </p>
    </div>
    <a class="button button-ghost" href="{base}/cycles">К планированию</a>
  </header>

  <div class="protocol-layout">
    <aside class="rail">
      <div class="rail-search">
        <input
          class="field-input"
          type="search"
          placeholder="Поиск протокола…"
          bind:value={search}
        />
      </div>

      <div class="rail-scroll">
        <div class="rail-group-label">Базовые · {filteredBundled.length}</div>
        <div class="rail-list">
          {#each filteredBundled as tpl (tpl.id)}
            {@const uses = usageCount(tpl.id)}
            {@const scale = Math.max(peakPct(tpl), 1)}
            <button
              type="button"
              class="rail-item"
              class:active={tpl.id === activeTemplate.id}
              onclick={() => selectTemplate(tpl.id)}
            >
              <span class="rail-spark" aria-hidden="true">
                {#each intensityPoints(tpl) as pt (pt.micro)}
                  <span class="spark-bar" style={`height:${Math.max(6, barHeight(pt.pct, scale))}%`}></span>
                {/each}
              </span>
              <span class="rail-text">
                <strong>{tpl.name}</strong>
                <small>{tpl.phases.length} фаз · пик {peakPct(tpl)}%</small>
              </span>
              {#if uses > 0}
                <span class="rail-badge" title="Используется в плане">{uses}×</span>
              {/if}
            </button>
          {/each}
          {#if filteredBundled.length === 0}
            <p class="rail-empty">Ничего не найдено</p>
          {/if}
        </div>

        <div class="rail-group-label">Свои · {filteredCustom.length}</div>
        <div class="rail-list">
          {#each filteredCustom as tpl (tpl.id)}
            {@const uses = usageCount(tpl.id)}
            {@const scale = Math.max(peakPct(tpl), 1)}
            <button
              type="button"
              class="rail-item"
              class:active={tpl.id === activeTemplate.id}
              onclick={() => selectTemplate(tpl.id)}
            >
              <span class="rail-spark" aria-hidden="true">
                {#each intensityPoints(tpl) as pt (pt.micro)}
                  <span class="spark-bar" style={`height:${Math.max(6, barHeight(pt.pct, scale))}%`}></span>
                {/each}
              </span>
              <span class="rail-text">
                <strong>{tpl.name}</strong>
                <small>{tpl.phases.length} фаз · пик {peakPct(tpl)}%</small>
              </span>
              {#if uses > 0}
                <span class="rail-badge" title="Используется в плане">{uses}×</span>
              {/if}
            </button>
          {/each}
          {#if filteredCustom.length === 0}
            <p class="rail-empty">{search ? 'Ничего не найдено' : 'Своих протоколов пока нет'}</p>
          {/if}
        </div>
      </div>

      <button type="button" class="button button-primary rail-add" onclick={handleCreateProtocolTemplate}>
        + Новый протокол
      </button>
    </aside>

    <section class="detail card card-pad">
      <div class="detail-head">
        <div>
          <div class="detail-kind">{activeTemplateIsBundled ? 'Базовый метод' : 'Свой протокол'}</div>
          <h2>{activeTemplate.name}</h2>
          {#if activeTemplate.description}
            <p class="muted detail-desc">{activeTemplate.description}</p>
          {/if}
        </div>
        <div class="detail-actions">
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
      </div>

      <div class="tabs" role="tablist">
        <button type="button" class="tab" class:active={tab === 'overview'} role="tab" onclick={() => (tab = 'overview')}>
          Обзор
        </button>
        <button type="button" class="tab" class:active={tab === 'editor'} role="tab" onclick={() => (tab = 'editor')}>
          Редактор
        </button>
        <button type="button" class="tab" class:active={tab === 'usage'} role="tab" onclick={() => (tab = 'usage')}>
          Где используется{#if activeUsage.length} · {activeUsage.length}{/if}
        </button>
      </div>

      {#if tab === 'overview'}
        <div class="tab-panel">
          <h3 class="block-title">Интенсивность по микроциклам</h3>
          <div class="curve">
            {#each curvePoints as pt (pt.micro)}
              <div class="curve-col" title={pt.label ?? ''}>
                <span class="curve-pct">{pt.pct ? `${pt.pct}%` : '—'}</span>
                <div class="curve-bar-wrap">
                  <div class="curve-bar" style={`height:${Math.max(2, barHeight(pt.pct, curveScale))}%`}></div>
                </div>
                <span class="curve-micro">μ{pt.micro}</span>
              </div>
            {/each}
          </div>

          <h3 class="block-title">В твоих килограммах</h3>
          <div class="preview-controls">
            <label>
              Упражнение
              <select class="field-select" bind:value={previewExercise}>
                {#each strengthExercises as name (name)}
                  <option value={name}>{name}</option>
                {/each}
              </select>
            </label>
            <label>
              1ПМ, кг {#if !previewAnchorInput && previewAnchor}<small class="hint">авто {fmtNum(previewAnchor)}</small>{/if}
              <input
                class="field-input"
                inputmode="decimal"
                placeholder={previewAnchor ? String(fmtNum(previewAnchor)) : 'введите 1ПМ'}
                bind:value={previewAnchorInput}
              />
            </label>
          </div>
          {#if previewAnchor}
            <div class="matrix-wrap">
              <table class="matrix">
                <thead>
                  <tr>
                    <th></th>
                    {#each previewRows as row (row.micro)}
                      <th>μ{row.micro}</th>
                    {/each}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">%1ПМ</th>
                    {#each previewRows as row (row.micro)}
                      <td>{row.pct ? `${row.pct}%` : '—'}</td>
                    {/each}
                  </tr>
                  <tr>
                    <th scope="row">{hasScheme ? 'Верх. вес' : 'Вес'}</th>
                    {#each previewRows as row (row.micro)}
                      <td class="kg">{row.weight ? `${fmtNum(row.weight)}` : '—'}</td>
                    {/each}
                  </tr>
                  {#if hasScheme}
                    <tr>
                      <th scope="row">Подходы</th>
                      {#each previewRows as row (row.micro)}
                        <td>
                          {#if row.breakdown}
                            <div class="step-lines">
                              {#each row.breakdown as step (step.id)}
                                <span class="step-line">
                                  <span class="step-reps">{step.label}</span>
                                  <span class="step-kg">{step.weight ? fmtNum(step.weight) : `${step.pct}%`}</span>
                                  {#if step.note}<span class="step-note">{step.note}</span>{/if}
                                </span>
                              {/each}
                            </div>
                          {:else}
                            <span class="muted">—</span>
                          {/if}
                        </td>
                      {/each}
                    </tr>
                  {/if}
                </tbody>
              </table>
            </div>
          {:else}
            <p class="muted">Выберите упражнение с историей или введите 1ПМ, чтобы увидеть целевые веса.</p>
          {/if}

          {#if activeProtocolGuide}
            <h3 class="block-title">Справка по методу</h3>
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
        </div>
      {:else if tab === 'editor'}
        <div class="tab-panel">
          {#if activeTemplateIsBundled}
            <div class="notice">
              Это базовый метод. Менять можно, но безопаснее
              <button type="button" class="link-button" onclick={handleDuplicateProtocolTemplate}>сделать копию</button>
              и править её. Имя базового метода зафиксировано.
            </div>
          {/if}

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
            <label>
              Описание
              <textarea
                class="field-input"
                rows="2"
                value={activeTemplate.description ?? ''}
                onchange={(e) => handleTemplateMeta('description', e.currentTarget.value)}
              ></textarea>
            </label>
          </div>

          {#if coverageIssues.length}
            <div class="notice warn">
              <strong>Проверьте диапазоны μ:</strong>
              <ul>
                {#each coverageIssues as issue}
                  <li>{issue}</li>
                {/each}
              </ul>
            </div>
          {/if}

          <h3 class="block-title">Фазы</h3>
          <div class="phase-grid">
            {#each activeTemplate.phases as phase, index (phase.id)}
              <article class="phase-card">
                <div class="phase-top">
                  <input
                    class="field-input"
                    type="text"
                    placeholder="Название фазы"
                    value={phase.label}
                    onchange={(e) => handlePhaseChange(index, 'label', e.currentTarget.value)}
                  />
                  {#if activeTemplate.phases.length > 1}
                    <button
                      type="button"
                      class="button button-danger phase-remove"
                      aria-label="Удалить фазу"
                      onclick={() => handleRemoveProtocolPhase(index)}
                    >
                      ×
                    </button>
                  {/if}
                </div>
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

                {#if phase.scheme?.length}
                  <div class="scheme">
                    <div class="scheme-head">
                      <span>подх.</span>
                      <span>повт.</span>
                      <span>%1ПМ</span>
                      <span>заметка</span>
                      <span></span>
                    </div>
                    {#each phase.scheme ?? [] as step, si (step.id)}
                      <div class="step-row">
                        <input
                          class="field-input"
                          type="number"
                          min="1"
                          value={step.sets}
                          onchange={(e) => handleStepChange(index, si, 'sets', e.currentTarget.value)}
                        />
                        <input
                          class="field-input"
                          type="number"
                          min="1"
                          value={step.reps}
                          onchange={(e) => handleStepChange(index, si, 'reps', e.currentTarget.value)}
                        />
                        <input
                          class="field-input"
                          type="number"
                          step="2.5"
                          value={step.intensityPct}
                          onchange={(e) => handleStepChange(index, si, 'intensityPct', e.currentTarget.value)}
                        />
                        <input
                          class="field-input"
                          type="text"
                          placeholder="—"
                          value={step.note ?? ''}
                          onchange={(e) => handleStepChange(index, si, 'note', e.currentTarget.value)}
                        />
                        <button
                          type="button"
                          class="step-del"
                          aria-label="Удалить ступень"
                          onclick={() => handleRemoveStep(index, si)}
                        >
                          ×
                        </button>
                      </div>
                    {/each}
                    <div class="scheme-actions">
                      <button type="button" class="button button-secondary btn-sm" onclick={() => handleAddStep(index)}>
                        + ступень
                      </button>
                      <button type="button" class="link-button" onclick={() => handleClearScheme(index)}>
                        Убрать раскладку
                      </button>
                    </div>
                  </div>
                {:else}
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
                  <button type="button" class="link-button scheme-detail" onclick={() => handleDetailPhase(index)}>
                    Расписать по подходам →
                  </button>
                {/if}
              </article>
            {/each}
          </div>
          <button type="button" class="button button-secondary" onclick={handleAddProtocolPhase}>
            + Фаза (μ)
          </button>
        </div>
      {:else}
        <div class="tab-panel">
          {#if activeUsage.length === 0}
            <div class="empty-usage">
              <p class="muted">Этот протокол пока никуда не назначен.</p>
              <a class="button button-secondary" href="{base}/cycles">Открыть план</a>
            </div>
          {:else}
            <p class="muted usage-intro">Протокол назначен в этих мезоциклах:</p>
            <div class="usage-list">
              {#each activeUsage as row (row.meso.id)}
                <article class="usage-card">
                  <div class="usage-card-head">
                    <strong>{row.meso.label}</strong>
                    {#if row.asDefault}
                      <span class="usage-tag default">по умолчанию</span>
                    {/if}
                  </div>
                  {#if row.exercises.length}
                    <div class="usage-exercises">
                      {#each row.exercises as exercise (exercise)}
                        <span class="usage-chip">{exercise}</span>
                      {/each}
                    </div>
                  {:else if row.asDefault}
                    <p class="muted usage-note">Для всех упражнений без своего протокола.</p>
                  {/if}
                  <a class="usage-link" href="{base}/cycles?meso={row.meso.id}">Открыть в плане →</a>
                </article>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </section>
  </div>
</div>

<style>
  .protocol-layout {
    display: grid;
    grid-template-columns: 290px 1fr;
    gap: 16px;
    align-items: start;
  }

  /* ── Рейл ─────────────────────────────────── */
  .rail {
    position: sticky;
    top: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: calc(100vh - 32px);
  }

  .rail-search input {
    width: 100%;
  }

  .rail-scroll {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-right: 2px;
  }

  .rail-group-label {
    margin: 8px 2px 2px;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .rail-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .rail-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px;
    background: var(--surface-raised);
    border: 1px solid var(--line);
    border-left: 3px solid transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.12s ease, background 0.12s ease;
  }

  .rail-item:hover {
    background: var(--surface-2);
  }

  .rail-item.active {
    border-color: var(--line-strong);
    border-left-color: var(--accent);
    background: var(--surface-2);
  }

  .rail-spark {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    width: 38px;
    height: 28px;
    flex: 0 0 auto;
  }

  .spark-bar {
    flex: 1;
    min-height: 2px;
    background: var(--line-strong);
  }

  .rail-item.active .spark-bar {
    background: var(--accent);
  }

  .rail-text {
    flex: 1;
    min-width: 0;
  }

  .rail-text strong {
    display: block;
    font-size: 13px;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .rail-text small {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .rail-badge {
    flex: 0 0 auto;
    padding: 1px 6px;
    color: var(--accent-ink);
    background: var(--accent);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 800;
  }

  .rail-empty {
    margin: 4px 2px;
    color: var(--muted);
    font-size: 12px;
  }

  .rail-add {
    width: 100%;
  }

  /* ── Деталь ───────────────────────────────── */
  .detail-head {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 14px;
  }

  .detail-kind {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 4px;
  }

  .detail-head h2 {
    margin: 0 0 6px;
    font-size: 22px;
  }

  .detail-desc {
    margin: 0;
    max-width: 640px;
    line-height: 1.5;
    font-size: 13px;
  }

  .detail-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--line);
    margin-bottom: 18px;
  }

  .tab {
    padding: 9px 14px;
    background: transparent;
    border: 0;
    border-bottom: 2px solid transparent;
    color: var(--muted);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    margin-bottom: -1px;
  }

  .tab:hover {
    color: var(--text);
  }

  .tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .tab-panel {
    display: block;
  }

  .block-title {
    margin: 0 0 12px;
    font-size: 13px;
    font-family: var(--font-mono);
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--muted-strong);
  }

  .block-title:not(:first-child) {
    margin-top: 26px;
  }

  /* ── Кривая интенсивности ─────────────────── */
  .curve {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    height: 150px;
    padding: 8px 4px 0;
    border-bottom: 1px solid var(--line);
  }

  .curve-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
    gap: 4px;
  }

  .curve-pct {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--muted-strong);
  }

  .curve-bar-wrap {
    flex: 1;
    width: 100%;
    max-width: 46px;
    display: flex;
    align-items: flex-end;
  }

  .curve-bar {
    width: 100%;
    background: linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 55%, transparent));
    min-height: 2px;
  }

  .curve-micro {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--muted);
  }

  /* ── В килограммах ────────────────────────── */
  .preview-controls {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 12px;
    margin-bottom: 14px;
  }

  .preview-controls label {
    display: grid;
    gap: 5px;
    font-size: 12px;
    color: var(--muted);
  }

  .hint {
    color: var(--accent);
    font-family: var(--font-mono);
  }

  /* ── Таблицы ──────────────────────────────── */
  .matrix-wrap {
    overflow: auto;
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
    font-family: var(--font-mono);
  }

  .matrix tbody th {
    color: var(--muted-strong);
    font-weight: 650;
    white-space: nowrap;
  }

  .matrix td.kg {
    font-family: var(--font-mono);
    color: var(--accent);
    font-weight: 700;
  }

  .protocol-guide {
    font-size: 13px;
    line-height: 1.45;
  }

  .protocol-guide p {
    margin: 0 0 10px;
  }

  .protocol-guide-list {
    margin: 0 0 12px;
    padding-left: 1.1rem;
    display: grid;
    gap: 4px;
  }

  /* ── Редактор ─────────────────────────────── */
  .notice {
    padding: 10px 12px;
    margin-bottom: 14px;
    background: var(--surface-raised);
    border: 1px solid var(--line);
    border-left: 3px solid var(--blue);
    font-size: 12.5px;
    line-height: 1.5;
  }

  .notice.warn {
    border-left-color: var(--hazard);
  }

  .notice ul {
    margin: 6px 0 0;
    padding-left: 1.1rem;
    display: grid;
    gap: 3px;
  }

  .link-button {
    padding: 0;
    background: transparent;
    border: 0;
    color: var(--accent);
    cursor: pointer;
    font: inherit;
    text-decoration: underline;
  }

  .protocol-meta {
    display: grid;
    gap: 12px;
    margin-bottom: 16px;
  }

  .protocol-meta label {
    display: grid;
    gap: 5px;
    font-size: 12px;
    color: var(--muted);
  }

  .protocol-meta textarea {
    resize: vertical;
    min-height: 3rem;
  }

  .phase-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
    margin: 0 0 14px;
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

  .phase-top {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .phase-top .field-input {
    flex: 1;
  }

  .phase-remove {
    flex: 0 0 auto;
    min-width: 2rem;
    padding-inline: 0.5rem;
  }

  /* ── Раскладка по подходам ────────────────── */
  .scheme {
    display: grid;
    gap: 6px;
    padding: 8px;
    background: var(--surface-2);
    border: 1px solid var(--line);
  }

  .scheme-head,
  .step-row {
    display: grid;
    grid-template-columns: 3rem 3rem 3.4rem 1fr 1.6rem;
    gap: 5px;
    align-items: center;
  }

  .scheme-head {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .step-row .field-input {
    width: 100%;
    padding: 5px 6px;
    font-size: 12px;
  }

  .step-del {
    background: transparent;
    border: 1px solid var(--line);
    color: var(--muted);
    cursor: pointer;
    line-height: 1;
    padding: 5px 0;
  }

  .step-del:hover {
    color: var(--danger, #e5484d);
    border-color: currentColor;
  }

  .scheme-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 2px;
  }

  .btn-sm {
    padding: 4px 10px;
    font-size: 11px;
  }

  .scheme-detail {
    justify-self: start;
    font-family: var(--font-mono);
    font-size: 11px;
  }

  /* раскладка в «в килограммах» */
  .step-lines {
    display: grid;
    gap: 3px;
  }

  .step-line {
    display: flex;
    align-items: baseline;
    gap: 6px;
    white-space: nowrap;
  }

  .step-reps {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--muted-strong);
  }

  .step-kg {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 700;
    color: var(--accent);
  }

  .step-note {
    font-size: 10px;
    color: var(--muted);
  }

  /* ── Где используется ─────────────────────── */
  .usage-intro {
    margin: 0 0 12px;
  }

  .usage-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 12px;
  }

  .usage-card {
    padding: 14px;
    background: var(--surface-raised);
    border: 1px solid var(--line);
  }

  .usage-card-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .usage-card-head strong {
    font-size: 14px;
  }

  .usage-tag {
    padding: 1px 7px;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .usage-tag.default {
    color: var(--accent-ink);
    background: var(--accent);
  }

  .usage-exercises {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-bottom: 10px;
  }

  .usage-chip {
    padding: 2px 7px;
    color: var(--muted-strong);
    background: var(--surface-2);
    border: 1px solid var(--line);
    font-size: 11px;
  }

  .usage-note {
    margin: 0 0 10px;
    font-size: 12px;
  }

  .usage-link {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--accent);
    text-decoration: none;
  }

  .empty-usage {
    display: grid;
    gap: 12px;
    justify-items: start;
  }

  /* ── Адаптив ──────────────────────────────── */
  @media (max-width: 860px) {
    .protocol-layout {
      grid-template-columns: 1fr;
    }

    .rail {
      position: static;
      max-height: none;
    }

    .rail-scroll {
      max-height: 320px;
    }

    .preview-controls {
      grid-template-columns: 1fr;
    }
  }
</style>
