<script lang="ts">
	import { base } from '$app/paths';
	import {
		addMicrocycle,
		assignDate,
		createMesocycle,
		markAnchorManual,
		removeMesocycle,
		removeMicrocycle,
		removeExerciseFromMeso,
		syncMesoExercises,
		unassignDate,
		updateExerciseProtocol,
		updateMesocycle,
		updateTemplate,
		type EnrichedMesocycle,
		type ExerciseAnchorInfo
	} from '$lib/cycle-plan';
	import { formatDateRu, fmtNum } from '$lib/format';
	import { mesocycleColor, slotColor, slotLabel } from '$lib/microcycle';
	import { DEFAULT_PROTOCOL_TEMPLATE } from '$lib/protocol';
	import {
		clearCyclePlanState,
		importCyclePlanFromAuto,
		refreshMesoAnchorsFromData,
		saveCyclePlanState,
		workoutStore
	} from '$lib/workout-store';

	type MesoTab = 'plan' | 'workouts' | 'settings';

	let editMode = $state(false);
	let showHelp = $state(false);
	let showMoreActions = $state(false);
	let showProtocolEditor = $state(false);
	let mesoTab = $state<MesoTab>('plan');
	let mesoPick = $state<string | null>(null);
	let selectedTemplateId = $state(DEFAULT_PROTOCOL_TEMPLATE.id);

	const view = $derived(workoutStore.view);
	const templates = $derived(view.templates);
	const cyclePlanView = $derived(view.cyclePlanView);
	const plan = $derived(cyclePlanView.plan);
	const displayMesos = $derived(cyclePlanView.mesocycles);
	const usingManual = $derived(cyclePlanView.usingManualPlan);
	const unassigned = $derived(cyclePlanView.unassignedDates);

	const selectedMeso = $derived.by(() => {
		if (displayMesos.length === 0) return null;
		const pick =
			mesoPick && displayMesos.some((meso) => meso.plan.id === mesoPick)
				? mesoPick
				: displayMesos[displayMesos.length - 1].plan.id;
		return displayMesos.find((meso) => meso.plan.id === pick) ?? null;
	});

	const activeTemplate = $derived(
		plan?.templates.find((item) => item.id === selectedTemplateId) ??
			plan?.templates[0] ??
			DEFAULT_PROTOCOL_TEMPLATE
	);

	function mesoExerciseNames(meso: EnrichedMesocycle): string[] {
		const names = new Set<string>();
		for (const micro of meso.microcycles) {
			for (const day of [micro.dayA, micro.dayB]) {
				if (!day) continue;
				for (const exercise of day.exercises) names.add(exercise);
			}
		}
		return [...names];
	}

	function exerciseTemplateId(meso: EnrichedMesocycle, exercise: string): string {
		return meso.plan.exerciseProtocols?.[exercise] ?? meso.plan.templateId;
	}

	function anchorSourceLabel(info: ExerciseAnchorInfo): string {
		if (info.manual) return 'вручную';
		if (info.source === 'prior') return 'до старта мезо';
		if (info.source === 'in_meso') return 'первый блок';
		return '';
	}

	function save(next: NonNullable<typeof plan>) {
		saveCyclePlanState(next);
	}

	function handleImport() {
		importCyclePlanFromAuto();
		editMode = true;
		mesoTab = 'settings';
	}

	function handleCreateMeso() {
		let current = plan;
		if (!current) {
			importCyclePlanFromAuto();
			current = workoutStore.cyclePlan;
		}
		if (!current) return;
		const next = createMesocycle(current);
		save(next);
		mesoPick = next.mesocycles[next.mesocycles.length - 1]?.id ?? null;
		mesoTab = 'settings';
	}

	function handleRemoveMeso(mesoId: string) {
		if (!plan || !confirm('Удалить мезоцикл из плана?')) return;
		save(removeMesocycle(plan, mesoId));
	}

	function handleAddMicro(mesoId: string) {
		if (!plan) return;
		save(addMicrocycle(plan, mesoId));
	}

	function handleRemoveMicro(mesoId: string, microId: string) {
		if (!plan) return;
		save(removeMicrocycle(plan, mesoId, microId));
	}

	function handleAssign(mesoId: string, microId: string, date: string) {
		if (!plan || !date) return;
		save(assignDate(plan, mesoId, microId, date));
	}

	function handleUnassign(date: string) {
		if (!plan) return;
		save(unassignDate(plan, date));
	}

	function handleMesoLabel(meso: EnrichedMesocycle, label: string) {
		if (!plan) return;
		save(updateMesocycle(plan, meso.plan.id, { label }));
	}

	function handleAnchor1rm(meso: EnrichedMesocycle, exercise: string, value: string) {
		if (!plan) return;
		const parsed = Number(value.replace(',', '.'));
		if (!Number.isFinite(parsed) || parsed <= 0) return;
		save(markAnchorManual(plan, meso.plan.id, exercise, parsed));
	}

	function handleSyncExercises(meso: EnrichedMesocycle) {
		if (!plan) return;
		save(
			syncMesoExercises(
				plan,
				meso.plan.id,
				mesoExerciseNames(meso),
				view.entries,
				meso.plan.startDate,
				meso.plan.endDate
			)
		);
	}

	function handleExerciseProtocol(meso: EnrichedMesocycle, exercise: string, templateId: string) {
		if (!plan) return;
		save(
			updateExerciseProtocol(
				plan,
				meso.plan.id,
				exercise,
				templateId === meso.plan.templateId ? null : templateId
			)
		);
	}

	function handleRemoveExercise(meso: EnrichedMesocycle, exercise: string) {
		if (!plan) return;
		save(removeExerciseFromMeso(plan, meso.plan.id, exercise));
	}

	function handlePhaseChange(
		index: number,
		field: 'label' | 'intensityPct' | 'microFrom' | 'microTo',
		value: string
	) {
		if (!plan) return;
		const phases = activeTemplate.phases.map((phase, i) => {
			if (i !== index) return phase;
			if (field === 'label') return { ...phase, label: value };
			const num = Number(value.replace(',', '.'));
			if (!Number.isFinite(num)) return phase;
			return { ...phase, [field]: num };
		});
		save(updateTemplate(plan, { ...activeTemplate, phases }));
	}

	function shortProtocolName(name: string): string {
		return name.replace('4×микро', '4μ').replace('~80%', '80%');
	}
</script>

<div class="cycles-page">

<!-- 1. Шапка -->
<section class="card page-head">
	<div>
		<h2>Циклы тренировок</h2>
		<p class="muted">
			Мезоцикл — блок из микроциклов (A+B). У каждого упражнения свой 1ПМ и протокол % по μ.
		</p>
	</div>
	<div class="head-actions">
		{#if !usingManual}
			<button type="button" class="btn primary" onclick={handleImport}>Импорт из авто</button>
		{:else}
			<button type="button" class="btn" class:active={editMode} onclick={() => (editMode = !editMode)}>
				{editMode ? '✓ Редактирование' : 'Редактировать'}
			</button>
			<div class="more-wrap">
				<button type="button" class="btn" onclick={() => (showMoreActions = !showMoreActions)}>
					Ещё ▾
				</button>
				{#if showMoreActions}
					<div class="more-menu">
						<button type="button" onclick={() => refreshMesoAnchorsFromData(true)}>Пересчитать 1ПМ</button>
						<button type="button" onclick={() => (showProtocolEditor = !showProtocolEditor)}>
							{showProtocolEditor ? 'Скрыть шаблоны %' : 'Шаблоны протокола'}
						</button>
						<button type="button" class="danger" onclick={clearCyclePlanState}>Сбросить план</button>
					</div>
				{/if}
			</div>
		{/if}
		<button type="button" class="btn ghost-link" onclick={() => (showHelp = !showHelp)}>
			{showHelp ? 'Скрыть справку' : 'Справка A/B'}
		</button>
	</div>
</section>

{#if showHelp}
	<section class="card help-card">
		<h3>Шаблоны тренировок A / B</h3>
		<div class="ab-grid">
			{#each templates as template}
				<article class="ab-card" style="--slot-color: {slotColor(template.slot)}">
					<span class="slot-badge">{template.slot}</span>
					<strong>{slotLabel(template.slot)}</strong>
					<p class="muted">{template.label}</p>
					<p class="meta">{template.sessions} дней в базе</p>
				</article>
			{/each}
		</div>
	</section>
{/if}

{#if showProtocolEditor && plan}
	<section class="card">
		<h3>Шаблоны протокола (% от 1ПМ)</h3>
		<p class="muted">Назначаются каждому упражнению отдельно во вкладке «Настройки».</p>
		<div class="template-picker">
			<label>
				<span>Редактировать</span>
				<select bind:value={selectedTemplateId} class="field-select">
					{#each plan.templates as tpl}
						<option value={tpl.id}>{tpl.name}</option>
					{/each}
				</select>
			</label>
		</div>
		<div class="phase-grid">
			{#each activeTemplate.phases as phase, index}
				<div class="phase-card">
					<input
						class="field-input"
						type="text"
						value={phase.label}
						disabled={!editMode}
						onchange={(e) => handlePhaseChange(index, 'label', e.currentTarget.value)}
					/>
					<label>
						<span>%1ПМ</span>
						<input
							class="field-input"
							type="number"
							step="2.5"
							value={phase.intensityPct}
							disabled={!editMode}
							onchange={(e) => handlePhaseChange(index, 'intensityPct', e.currentTarget.value)}
						/>
					</label>
					<label>
						<span>μ</span>
						<input
							class="field-input narrow"
							type="number"
							value={phase.microFrom}
							disabled={!editMode}
							onchange={(e) => handlePhaseChange(index, 'microFrom', e.currentTarget.value)}
						/>
						<span>—</span>
						<input
							class="field-input narrow"
							type="number"
							value={phase.microTo}
							disabled={!editMode}
							onchange={(e) => handlePhaseChange(index, 'microTo', e.currentTarget.value)}
						/>
					</label>
				</div>
			{/each}
		</div>
	</section>
{/if}

<!-- 2. Выбор мезоцикла -->
{#if displayMesos.length === 0}
	<section class="card empty-state">
		<h3>Нет данных о циклах</h3>
		<p class="muted">Импортируй автоопределение из тренировок, чтобы увидеть мезо- и микроциклы.</p>
		{#if !usingManual}
			<button type="button" class="btn primary" onclick={handleImport}>Импорт из авто</button>
		{/if}
	</section>
{:else}
	<section class="card meso-picker">
		<div class="picker-head">
			<h3>Мезоциклы</h3>
			{#if editMode && usingManual}
				<button type="button" class="btn small primary" onclick={handleCreateMeso}>+ Новый</button>
			{/if}
		</div>
		<div class="meso-tabs">
			{#each displayMesos as meso (meso.plan.id)}
				<button
					type="button"
					class="meso-tab"
					class:active={selectedMeso?.plan.id === meso.plan.id}
					style="--meso-color: {mesocycleColor(meso.index)}"
					onclick={() => (mesoPick = meso.plan.id)}
				>
					<span class="meso-tab-num">#{meso.index}</span>
					<span class="meso-tab-label">{meso.plan.label}</span>
					<span class="meso-tab-dates">
						{formatDateRu(meso.plan.startDate)} — {formatDateRu(meso.plan.endDate)}
					</span>
				</button>
			{/each}
		</div>
	</section>

	{#if selectedMeso}
		<!-- 3. Детали выбранного мезо -->
		<section class="card meso-detail" style="--meso-color: {mesocycleColor(selectedMeso.index)}">
			<div class="detail-head">
				<div>
					<p class="detail-kicker">Мезоцикл #{selectedMeso.index}</p>
					{#if editMode && plan}
						<input
							class="detail-title-input"
							value={selectedMeso.plan.label}
							onchange={(e) => handleMesoLabel(selectedMeso, e.currentTarget.value)}
						/>
					{:else}
						<h3>{selectedMeso.plan.label}</h3>
					{/if}
					<p class="muted">
						{formatDateRu(selectedMeso.plan.startDate)} — {formatDateRu(selectedMeso.plan.endDate)}
						· {selectedMeso.durationDays} дн.
						· {selectedMeso.completeMicrocycles}/{selectedMeso.microcycles.length} полных μ
					</p>
				</div>
				{#if editMode && plan}
					<div class="detail-actions">
						<button type="button" class="btn small" onclick={() => handleAddMicro(selectedMeso.plan.id)}>
							+ μ
						</button>
						<button
							type="button"
							class="btn small danger"
							onclick={() => handleRemoveMeso(selectedMeso.plan.id)}
						>
							Удалить мезо
						</button>
					</div>
				{/if}
			</div>

			<!-- Внутренние вкладки -->
			<div class="sub-tabs">
				<button
					type="button"
					class="sub-tab"
					class:active={mesoTab === 'plan'}
					onclick={() => (mesoTab = 'plan')}
				>
					План (% и цели)
				</button>
				<button
					type="button"
					class="sub-tab"
					class:active={mesoTab === 'workouts'}
					onclick={() => (mesoTab = 'workouts')}
				>
					Тренировки (μ)
				</button>
				{#if editMode && usingManual}
					<button
						type="button"
						class="sub-tab"
						class:active={mesoTab === 'settings'}
						onclick={() => (mesoTab = 'settings')}
					>
						Настройки
					</button>
				{/if}
			</div>

			{#if mesoTab === 'plan'}
				<div class="tab-panel">
					<p class="panel-hint muted">
						План (% и кг) · факт — пик %1ПМ за микроцикл (лучший подход)
					</p>
					<div class="matrix-wrap">
						<table class="matrix">
							<colgroup>
								<col class="col-ex" />
								<col class="col-rm" />
								<col class="col-proto" />
								{#each selectedMeso.microcycles as _micro}
									<col class="col-micro" />
								{/each}
							</colgroup>
							<thead>
								<tr>
									<th>Упражнение</th>
									<th>1ПМ</th>
									<th>Протокол</th>
									{#each selectedMeso.microcycles as micro}
										<th>μ{micro.plan.indexInMeso}</th>
									{/each}
								</tr>
							</thead>
							<tbody>
								{#each selectedMeso.protocolMatrix as row}
									<tr>
										<td class="ex-name">{row.exercise}</td>
										<td class="rm-cell">{fmtNum(row.anchor)}</td>
										<td class="proto-name" title={row.templateName}>
											{shortProtocolName(row.templateName)}
										</td>
										{#each row.cells as cell}
											<td
												class="pct"
												class:match={!cell.plannedOnly &&
													cell.pct != null &&
													cell.factMaxPct != null &&
													Math.abs(cell.factMaxPct - cell.pct) <= 3}
												title={cell.label ?? ''}
											>
												<div class="cell-plan">
													<span class="cell-label">план</span>
													<span class="pct-val">{cell.pct != null ? `${cell.pct}%` : '—'}</span>
													{#if cell.targetWeight != null}
														<small>{fmtNum(cell.targetWeight)} кг</small>
													{/if}
												</div>
												<div class="cell-fact">
													<span class="cell-label">факт</span>
													{#if cell.plannedOnly || cell.factMaxPct == null}
														<span class="fact-empty">—</span>
													{:else}
														<span class="fact-val">{fmtNum(cell.factMaxPct)}%</span>
														<small>{fmtNum(cell.factMaxWeight)} кг</small>
													{/if}
												</div>
											</td>
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{:else if mesoTab === 'workouts'}
				<div class="tab-panel micro-timeline">
					{#each selectedMeso.microcycles as micro}
						<article class="micro-block" class:complete={micro.complete}>
							<div class="micro-top">
								<span class="micro-label">μ{micro.plan.indexInMeso}</span>
								<div class="micro-days">
									{#if micro.dayA}
										<a class="day-link a" href="{base}/?date={micro.dayA.date}">
											A · {formatDateRu(micro.dayA.date)}
										</a>
									{/if}
									{#if micro.dayB}
										<a class="day-link b" href="{base}/?date={micro.dayB.date}">
											B · {formatDateRu(micro.dayB.date)}
										</a>
									{/if}
								</div>
								<span class="micro-badge" class:ok={micro.complete}>
									{micro.complete ? 'A+B' : 'неполный'}
								</span>
							</div>
							{#if micro.intensityByExercise.length > 0}
								<table class="result-table">
									<thead>
										<tr>
											<th></th>
											<th>Цель</th>
											<th>Факт</th>
										</tr>
									</thead>
									<tbody>
										{#each micro.intensityByExercise as row}
											<tr class:match={!row.plannedOnly && Math.abs(row.maxPct - row.targetPct) <= 3}>
												<td>
													<strong>{row.exercise}</strong>
													<small class="muted">{row.protocolLabel ?? ''}</small>
												</td>
												<td>
													{fmtNum(row.targetWeight)} кг
													<small class="muted">({row.targetPct}%)</small>
												</td>
												<td>
													{#if row.plannedOnly}
														<span class="muted">—</span>
													{:else}
														{fmtNum(row.maxPct)}%
													{/if}
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							{:else}
								<p class="muted empty-micro">Нет данных по упражнениям</p>
							{/if}
						</article>
					{/each}
					{#if selectedMeso.gapAfterDays !== null && selectedMeso.gapAfterDays >= 14}
						<p class="gap-note">
							Перерыв до следующего блока: {Math.round(selectedMeso.gapAfterDays / 7)} нед.
						</p>
					{/if}
				</div>
			{:else if mesoTab === 'settings' && editMode && plan}
				<div class="tab-panel">
					{#if unassigned.length > 0}
						<div class="settings-block">
							<h4>Нераспределённые дни ({unassigned.length})</h4>
							<div class="chip-row">
								{#each unassigned as date}
									<span class="chip">{formatDateRu(date)}</span>
								{/each}
							</div>
						</div>
					{/if}

					<div class="settings-block">
						<div class="block-head">
							<h4>Упражнения: 1ПМ и протокол</h4>
							<button type="button" class="btn small" onclick={() => handleSyncExercises(selectedMeso)}>
								Подтянуть из тренировок
							</button>
						</div>
						<div class="exercise-settings">
							{#each Object.entries(selectedMeso.anchorInfo) as [exercise, info]}
								<div class="exercise-setting-row">
									<div class="exercise-setting-main">
										<strong>{exercise}</strong>
										<span class="muted">{anchorSourceLabel(info)}</span>
									</div>
									<label>
										<span>1ПМ, кг</span>
										<input
											type="number"
											step="0.5"
											class="field-input"
											value={info.anchor}
											onchange={(e) => handleAnchor1rm(selectedMeso, exercise, e.currentTarget.value)}
										/>
									</label>
									<label>
										<span>Протокол</span>
										<select
											class="field-select"
											value={exerciseTemplateId(selectedMeso, exercise)}
											onchange={(e) =>
												handleExerciseProtocol(selectedMeso, exercise, e.currentTarget.value)}
										>
											{#each plan.templates as tpl}
												<option value={tpl.id}>{tpl.name}</option>
											{/each}
										</select>
									</label>
									<button
										type="button"
										class="btn small danger"
										onclick={() => handleRemoveExercise(selectedMeso, exercise)}
									>
										×
									</button>
								</div>
							{/each}
						</div>
					</div>

					<div class="settings-block">
						<h4>Распределение дней по μ</h4>
						<div class="assign-grid">
							{#each selectedMeso.microcycles as micro}
								<div class="assign-card">
									<div class="assign-head">
										<strong>μ{micro.plan.indexInMeso}</strong>
										<button
											type="button"
											class="btn small danger"
											onclick={() => handleRemoveMicro(selectedMeso.plan.id, micro.plan.id)}
										>
											×
										</button>
									</div>
									<div class="chip-row">
										{#each micro.plan.dates as date}
											<span class="chip">
												{formatDateRu(date)}
												<button type="button" class="chip-x" onclick={() => handleUnassign(date)}>×</button>
											</span>
										{/each}
										{#if micro.plan.dates.length === 0}
											<span class="muted">нет дней</span>
										{/if}
									</div>
									{#if unassigned.length > 0}
										<select
											class="field-select"
											onchange={(e) => {
												handleAssign(selectedMeso.plan.id, micro.plan.id, e.currentTarget.value);
												e.currentTarget.value = '';
											}}
										>
											<option value="">+ добавить день</option>
											{#each unassigned as date}
												<option value={date}>{formatDateRu(date)}</option>
											{/each}
										</select>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				</div>
			{/if}
		</section>
	{/if}
{/if}
</div>

<style>
	.cycles-page {
		display: grid;
		gap: 1rem;
		min-width: 0;
		max-width: 100%;
		overflow-x: clip;
	}
	h2,
	h3,
	h4 {
		margin: 0;
	}

	.page-head {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		align-items: start;
	}

	.page-head h2 {
		margin-bottom: 0.25rem;
	}

	.head-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		align-items: center;
	}

	.btn {
		border-radius: 10px;
		padding: 0.5rem 0.85rem;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
	}

	.btn.primary {
		border-color: rgba(110, 231, 168, 0.45);
		background: rgba(110, 231, 168, 0.14);
		color: var(--accent);
	}

	.btn.active {
		border-color: rgba(110, 231, 168, 0.5);
		background: rgba(110, 231, 168, 0.2);
		color: var(--accent);
	}

	.btn.small {
		padding: 0.3rem 0.55rem;
		font-size: 0.78rem;
	}

	.btn.danger,
	.btn.small.danger {
		color: var(--danger);
		border-color: rgba(255, 143, 143, 0.35);
	}

	.btn.ghost-link {
		background: transparent;
		color: var(--muted);
	}

	.more-wrap {
		position: relative;
	}

	.more-menu {
		position: absolute;
		top: calc(100% + 0.35rem);
		right: 0;
		z-index: 5;
		display: grid;
		min-width: 11rem;
		padding: 0.35rem;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--surface);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
	}

	.more-menu button {
		text-align: left;
		padding: 0.45rem 0.55rem;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--text);
	}

	.more-menu button:hover {
		background: var(--surface-2);
	}

	.more-menu button.danger {
		color: var(--danger);
	}

	.ab-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 0.75rem;
		margin-top: 0.75rem;
	}

	.ab-card {
		padding: 0.85rem;
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--slot-color) 35%, var(--border));
		background: color-mix(in srgb, var(--slot-color) 8%, var(--surface-2));
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

	.meta {
		margin: 0.25rem 0 0;
		font-size: 0.82rem;
		color: var(--muted);
	}

	.empty-state {
		text-align: center;
		padding: 2rem 1.25rem;
	}

	.empty-state h3 {
		margin-bottom: 0.35rem;
	}

	.empty-state .btn {
		margin-top: 1rem;
	}

	.picker-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.meso-picker {
		min-width: 0;
		overflow: hidden;
	}

	.meso-tabs {
		display: flex;
		gap: 0.5rem;
		overflow-x: auto;
		padding-bottom: 0.25rem;
		max-width: 100%;
		scrollbar-width: thin;
	}

	.meso-tab {
		flex: 0 0 auto;
		min-width: 9rem;
		padding: 0.65rem 0.85rem;
		border-radius: 12px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		text-align: left;
		color: var(--text);
	}

	.meso-tab.active {
		border-color: color-mix(in srgb, var(--meso-color) 55%, var(--border));
		background: color-mix(in srgb, var(--meso-color) 12%, var(--surface-2));
	}

	.meso-tab-num {
		display: block;
		font-weight: 800;
		color: var(--meso-color);
		font-size: 0.85rem;
	}

	.meso-tab-label {
		display: block;
		font-size: 0.82rem;
		margin-top: 0.15rem;
	}

	.meso-tab-dates {
		display: block;
		font-size: 0.72rem;
		color: var(--muted);
		margin-top: 0.15rem;
	}

	.meso-detail {
		border-color: color-mix(in srgb, var(--meso-color) 35%, var(--border));
		min-width: 0;
		overflow: hidden;
	}

	.detail-head {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}

	.detail-kicker {
		margin: 0 0 0.15rem;
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--meso-color);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.detail-title-input {
		width: 100%;
		max-width: 320px;
		font-size: 1.25rem;
		font-weight: 700;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--text);
		padding: 0.35rem 0.5rem;
		margin-bottom: 0.25rem;
	}

	.detail-actions {
		display: flex;
		gap: 0.35rem;
		align-items: start;
	}

	.sub-tabs {
		display: flex;
		gap: 0.35rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
		padding: 0.25rem;
		border-radius: 12px;
		background: var(--surface-2);
	}

	.sub-tab {
		padding: 0.45rem 0.85rem;
		border-radius: 8px;
		border: none;
		background: transparent;
		color: var(--muted);
		font-size: 0.85rem;
	}

	.sub-tab.active {
		background: var(--surface);
		color: var(--text);
		box-shadow: 0 1px 0 var(--border);
	}

	.panel-hint {
		margin: 0 0 0.75rem;
		font-size: 0.82rem;
	}

	.matrix-wrap {
		overflow-x: auto;
		max-width: 100%;
		margin: 0 -0.15rem;
		padding: 0 0.15rem 0.25rem;
		-webkit-overflow-scrolling: touch;
	}

	.matrix {
		width: 100%;
		min-width: 48rem;
		border-collapse: separate;
		border-spacing: 0;
		font-size: 0.82rem;
		table-layout: fixed;
	}

	.matrix :global(col.col-ex) {
		width: 14rem;
	}

	.matrix :global(col.col-rm) {
		width: 3.25rem;
	}

	.matrix :global(col.col-proto) {
		width: 5.5rem;
	}

	.matrix :global(col.col-micro) {
		width: 5.25rem;
	}

	.matrix th,
	.matrix td {
		padding: 0.55rem 0.45rem;
		border: 1px solid var(--border);
		text-align: center;
		vertical-align: middle;
		line-height: 1.25;
	}

	.matrix thead th {
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--surface-2);
		color: var(--muted);
		font-size: 0.72rem;
		font-weight: 600;
	}

	.matrix tbody tr:nth-child(even) td {
		background: rgba(255, 255, 255, 0.02);
	}

	.matrix .ex-name {
		text-align: left;
		font-weight: 600;
		font-size: 0.78rem;
		line-height: 1.25;
		word-break: break-word;
	}

	.matrix .rm-cell {
		font-weight: 600;
		white-space: nowrap;
	}

	.matrix .proto-name {
		text-align: left;
		font-size: 0.7rem;
		color: #c4b5fd;
		line-height: 1.2;
		word-break: break-word;
	}

	.matrix .pct {
		padding: 0.35rem 0.25rem;
		vertical-align: top;
	}

	.matrix .pct.match {
		background: rgba(110, 231, 168, 0.08);
	}

	.matrix .cell-plan,
	.matrix .cell-fact {
		display: grid;
		gap: 0.05rem;
		justify-items: center;
	}

	.matrix .cell-fact {
		margin-top: 0.35rem;
		padding-top: 0.3rem;
		border-top: 1px dashed var(--border);
	}

	.matrix .cell-label {
		font-size: 0.58rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted);
	}

	.matrix .pct small {
		display: block;
		font-size: 0.66rem;
		color: var(--muted);
		font-weight: 400;
		white-space: nowrap;
	}

	.matrix .pct-val {
		display: block;
		font-weight: 700;
		color: var(--accent-2);
	}

	.matrix .fact-val {
		display: block;
		font-weight: 700;
		color: var(--text);
	}

	.matrix .fact-empty {
		font-size: 0.75rem;
		color: var(--muted);
	}

	.matrix .pct.match .fact-val {
		color: var(--accent);
	}

	.micro-timeline {
		display: grid;
		gap: 0.75rem;
	}

	.micro-block {
		padding: 0.85rem;
		border-radius: 12px;
		border: 1px solid var(--border);
		background: var(--surface-2);
	}

	.micro-block.complete {
		border-color: rgba(110, 231, 168, 0.25);
	}

	.micro-top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.65rem;
	}

	.micro-label {
		font-weight: 800;
		font-size: 1rem;
		color: var(--muted);
		min-width: 2rem;
	}

	.micro-days {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		flex: 1;
	}

	.day-link {
		padding: 0.25rem 0.55rem;
		border-radius: 999px;
		text-decoration: none;
		font-size: 0.8rem;
		border: 1px solid var(--border);
	}

	.day-link.a {
		border-color: rgba(91, 157, 255, 0.35);
		background: rgba(91, 157, 255, 0.1);
		color: var(--text);
	}

	.day-link.b {
		border-color: rgba(110, 231, 168, 0.35);
		background: rgba(110, 231, 168, 0.1);
		color: var(--text);
	}

	.micro-badge {
		margin-left: auto;
		font-size: 0.75rem;
		color: #fbbf24;
	}

	.micro-badge.ok {
		color: var(--accent);
	}

	.result-table {
		width: 100%;
		font-size: 0.8rem;
		border-collapse: collapse;
		table-layout: fixed;
	}

	.result-table th,
	.result-table td {
		padding: 0.35rem 0.45rem;
		border-bottom: 1px solid var(--border);
		text-align: left;
		vertical-align: top;
	}

	.result-table th {
		color: var(--muted);
		font-size: 0.72rem;
		font-weight: 600;
	}

	.result-table tr.match td:last-child {
		color: var(--accent);
		font-weight: 600;
	}

	.result-table small {
		display: block;
		font-size: 0.68rem;
	}

	.empty-micro {
		margin: 0;
		font-size: 0.82rem;
	}

	.gap-note {
		margin: 0;
		font-size: 0.82rem;
		color: var(--danger);
	}

	.settings-block {
		padding: 0.85rem;
		border-radius: 12px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		margin-bottom: 0.75rem;
	}

	.settings-block h4 {
		margin-bottom: 0.5rem;
		font-size: 0.92rem;
	}

	.block-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.block-head h4 {
		margin: 0;
	}

	.chip-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.2rem 0.45rem;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface);
		font-size: 0.78rem;
	}

	.chip-x {
		border: none;
		background: transparent;
		color: var(--danger);
		padding: 0;
		line-height: 1;
	}

	.exercise-settings {
		display: grid;
		gap: 0.5rem;
	}

	.exercise-setting-row {
		display: grid;
		grid-template-columns: 1fr auto auto auto;
		gap: 0.5rem;
		align-items: end;
		padding: 0.5rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface);
	}

	.exercise-setting-main {
		display: grid;
		gap: 0.1rem;
	}

	.exercise-setting-row label {
		display: grid;
		gap: 0.15rem;
		font-size: 0.72rem;
		color: var(--muted);
	}

	.field-input,
	.field-select {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--text);
		padding: 0.35rem 0.5rem;
		min-width: 0;
	}

	.field-input.narrow {
		width: 3rem;
	}

	.assign-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.5rem;
	}

	.assign-card {
		padding: 0.65rem;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--surface);
		display: grid;
		gap: 0.45rem;
	}

	.assign-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.phase-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.phase-card {
		padding: 0.65rem;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		display: grid;
		gap: 0.45rem;
	}

	.phase-card label {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.72rem;
		color: var(--muted);
	}

	.template-picker {
		margin-top: 0.5rem;
	}

	.template-picker label {
		display: grid;
		gap: 0.2rem;
		font-size: 0.78rem;
		color: var(--muted);
		max-width: 240px;
	}

	@media (max-width: 720px) {
		.exercise-setting-row {
			grid-template-columns: 1fr;
		}

		.meso-tab {
			min-width: 7.5rem;
		}
	}
</style>
