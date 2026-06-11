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
	import {
		MESOCYCLE_TARGET_MICROS,
		mesocycleColor,
		slotColor,
		slotLabel
	} from '$lib/microcycle';
	import { DEFAULT_PROTOCOL_TEMPLATE, shortExerciseName } from '$lib/protocol';
	import {
		clearCyclePlanState,
		importCyclePlanFromAuto,
		refreshMesoAnchorsFromData,
		saveCyclePlanState,
		workoutView
	} from '$lib/workout-store';
	import { get } from 'svelte/store';

	let editMode = $state(false);
	let showProtocolEditor = $state(false);
	let selectedTemplateId = $state(DEFAULT_PROTOCOL_TEMPLATE.id);

	const { templates, mesocycles, cyclePlanView } = $derived($workoutView);
	const plan = $derived(cyclePlanView.plan);
	const displayMesos = $derived(cyclePlanView.mesocycles);
	const usingManual = $derived(cyclePlanView.usingManualPlan);
	const unassigned = $derived(cyclePlanView.unassignedDates);
	const microCount = $derived(displayMesos.reduce((sum, meso) => sum + meso.microcycles.length, 0));
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

	function templateName(meso: EnrichedMesocycle, exercise: string): string {
		const id = exerciseTemplateId(meso, exercise);
		return plan?.templates.find((item) => item.id === id)?.name ?? '—';
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
	}

	function handleCreateMeso() {
		let current = plan;
		if (!current) {
			importCyclePlanFromAuto();
			current = get(workoutView).cyclePlan;
		}
		if (!current) return;
		save(createMesocycle(current));
	}

	function handleRemoveMeso(mesoId: string) {
		if (!plan || !confirm('Удалить мезоцикл из плана? Даты станут нераспределёнными.')) return;
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
				get(workoutView).entries,
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

	function handlePhaseChange(index: number, field: 'label' | 'intensityPct' | 'microFrom' | 'microTo', value: string) {
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

	function protocolBarWidth(phase: (typeof activeTemplate.phases)[0], totalMicros: number): string {
		const span = phase.microTo - phase.microFrom + 1;
		return `${(span / Math.max(totalMicros, 1)) * 100}%`;
	}
</script>

<section class="card intro">
	<div>
		<h2>Мезо- и микроциклы</h2>
		<p class="muted">
			<strong>Микроцикл</strong> — пара A + B. У каждого упражнения свой <strong>1ПМ</strong> и свой
			<strong>протокол</strong> (% по μ). Якорный 1ПМ фиксируется на старт мезо и берётся из прошлого
			блока.
		</p>
	</div>
	<div class="intro-actions">
		{#if !usingManual}
			<button type="button" class="primary" onclick={handleImport}>Импорт из авто</button>
		{:else}
			<button type="button" class="ghost" onclick={() => (editMode = !editMode)}>
				{editMode ? 'Готово' : 'Редактировать'}
			</button>
			<button type="button" class="ghost" onclick={() => refreshMesoAnchorsFromData(true)}>
				Пересчитать 1ПМ
			</button>
			<button type="button" class="ghost" onclick={() => (showProtocolEditor = !showProtocolEditor)}>
				{showProtocolEditor ? 'Скрыть протокол' : 'Шаблон протокола'}
			</button>
			<button type="button" class="ghost danger-text" onclick={clearCyclePlanState}>
				Сбросить план
			</button>
		{/if}
		{#if usingManual && editMode}
			<button type="button" class="primary" onclick={handleCreateMeso}>+ Мезоцикл</button>
		{/if}
	</div>
</section>

{#if showProtocolEditor && plan}
	<section class="card protocol-editor">
		<div class="protocol-editor-head">
			<h3>Редактор шаблона протокола</h3>
			<select bind:value={selectedTemplateId} class="proto-select">
				{#each plan.templates as tpl}
					<option value={tpl.id}>{tpl.name}</option>
				{/each}
			</select>
		</div>
		<p class="muted">
			Шаблон назначается каждому упражнению отдельно в блоке ниже. Фазы — целевой % от <em>его</em> 1ПМ.
		</p>
		<div class="phase-table">
			{#each activeTemplate.phases as phase, index}
				<div class="phase-row">
					<input
						type="text"
						value={phase.label}
						disabled={!editMode}
						onchange={(e) => handlePhaseChange(index, 'label', e.currentTarget.value)}
					/>
					<label>
						<span>%1ПМ</span>
						<input
							type="number"
							min="50"
							max="100"
							step="2.5"
							value={phase.intensityPct}
							disabled={!editMode}
							onchange={(e) => handlePhaseChange(index, 'intensityPct', e.currentTarget.value)}
						/>
					</label>
					<label>
						<span>μ от</span>
						<input
							type="number"
							min="1"
							max="12"
							value={phase.microFrom}
							disabled={!editMode}
							onchange={(e) => handlePhaseChange(index, 'microFrom', e.currentTarget.value)}
						/>
					</label>
					<label>
						<span>μ до</span>
						<input
							type="number"
							min="1"
							max="12"
							value={phase.microTo}
							disabled={!editMode}
							onchange={(e) => handlePhaseChange(index, 'microTo', e.currentTarget.value)}
						/>
					</label>
				</div>
			{/each}
		</div>
		<div class="protocol-preview">
			{#each activeTemplate.phases as phase}
				<div
					class="proto-seg"
					style="width: {protocolBarWidth(phase, activeTemplate.phases[activeTemplate.phases.length - 1]?.microTo ?? 4)}"
					title="{phase.label}: {phase.intensityPct}% (μ{phase.microFrom}–{phase.microTo})"
				>
					<span>{phase.intensityPct}%</span>
					<small>{phase.label}</small>
				</div>
			{/each}
		</div>
	</section>
{/if}

<section class="card templates">
	<h3>Шаблоны A / B</h3>
	<div class="template-grid">
		{#each templates as template}
			<article class="template-card" style="--slot-color: {slotColor(template.slot)}">
				<div class="template-head">
					<span class="slot-badge">{template.slot}</span>
					<strong>{slotLabel(template.slot)}</strong>
				</div>
				<p class="muted">{template.label}</p>
				<p class="meta">{template.sessions} дней в базе</p>
			</article>
		{/each}
	</div>
</section>

{#if editMode && unassigned.length > 0}
	<section class="card unassigned">
		<h3>Нераспределённые дни ({unassigned.length})</h3>
		<div class="date-pool">
			{#each unassigned as date}
				<span class="pool-chip">{formatDateRu(date)}</span>
			{/each}
		</div>
	</section>
{/if}

<section class="card">
	<div class="toolbar">
		<h3>{usingManual ? 'План блоков' : 'История блоков (авто)'}</h3>
		<p class="muted">
			{displayMesos.length} мезоциклов · {microCount} микроциклов
			{#if !usingManual}· нажми «Импорт из авто», чтобы редактировать{/if}
		</p>
	</div>

	<div class="meso-list">
		{#each [...displayMesos].reverse() as meso}
			{@const totalMicros = meso.microcycles.length}
			<article
				class="meso-card"
				style="--meso-color: {mesocycleColor(meso.index)}"
			>
				<div class="meso-head">
					<div class="meso-title-block">
						{#if editMode && plan}
							<input
								class="meso-label-input"
								value={meso.plan.label}
								onchange={(e) => handleMesoLabel(meso, e.currentTarget.value)}
							/>
						{:else}
							<p class="meso-title">Мезоцикл #{meso.index}</p>
							<p class="muted meso-sub">{meso.plan.label}</p>
						{/if}
						<p class="muted meso-sub">
							{formatDateRu(meso.plan.startDate)} — {formatDateRu(meso.plan.endDate)}
							· {meso.durationDays} дн.
						</p>
					</div>
					<div class="meso-actions">
						<span class="meso-badge">
							{meso.completeMicrocycles}/{totalMicros} микро
						</span>
						{#if editMode && plan}
							<button type="button" class="ghost tiny" onclick={() => handleAddMicro(meso.plan.id)}>
								+ μ
							</button>
							<button
								type="button"
								class="ghost tiny danger-text"
								onclick={() => handleRemoveMeso(meso.plan.id)}
							>
								×
							</button>
						{/if}
					</div>
				</div>

				{#if Object.keys(meso.anchorInfo).length > 0 || editMode}
					<div class="exercises-block">
						<div class="exercises-head">
							<span class="anchors-label">Упражнения и протоколы</span>
							{#if editMode && plan}
								<button type="button" class="ghost tiny" onclick={() => handleSyncExercises(meso)}>
									Подтянуть из тренировок
								</button>
							{/if}
						</div>
						<div class="exercise-rows">
							{#each Object.entries(meso.anchorInfo) as [exercise, info]}
								<div class="exercise-row">
									<span class="exercise-name" title={exercise}>{shortExerciseName(exercise)}</span>
									<span class="anchor-value">
										1ПМ
										{#if editMode && plan}
											<input
												type="number"
												step="0.5"
												class="anchor-input"
												value={info.anchor}
												onchange={(e) => handleAnchor1rm(meso, exercise, e.currentTarget.value)}
											/>
										{:else}
											<strong>{fmtNum(info.anchor)}</strong> кг
										{/if}
									</span>
									<span class="anchor-meta muted">
										{anchorSourceLabel(info)}
										{#if info.anchorDate}
											· {formatDateRu(info.anchorDate)}
										{/if}
										{#if info.peakInMeso != null && info.peakInMeso > info.anchor}
											· пик {fmtNum(info.peakInMeso)} кг
											{#if info.peakDate}({formatDateRu(info.peakDate)}){/if}
										{/if}
									</span>
									{#if editMode && plan}
										<select
											class="proto-select"
											value={exerciseTemplateId(meso, exercise)}
											onchange={(e) =>
												handleExerciseProtocol(meso, exercise, e.currentTarget.value)}
										>
											{#each plan.templates as tpl}
												<option value={tpl.id}>{tpl.name}</option>
											{/each}
										</select>
										<button
											type="button"
											class="ghost tiny danger-text"
											onclick={() => handleRemoveExercise(meso, exercise)}
										>
											×
										</button>
									{:else}
										<span class="proto-badge">{templateName(meso, exercise)}</span>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<div class="protocol-matrix-wrap">
					<table class="protocol-matrix">
						<thead>
							<tr>
								<th>Упражнение</th>
								<th>1ПМ</th>
								<th>Протокол</th>
								{#each meso.microcycles as micro}
									<th>μ{micro.plan.indexInMeso}</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each meso.protocolMatrix as row}
								<tr>
									<td title={row.exercise}>{shortExerciseName(row.exercise)}</td>
									<td>{fmtNum(row.anchor)}</td>
									<td class="proto-cell">{row.templateName}</td>
									{#each row.cells as cell}
										<td class="pct-cell" title={cell.label ?? ''}>
											{cell.pct != null ? `${cell.pct}%` : '—'}
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<div class="micro-list">
					{#each meso.microcycles as micro}
						<div class="micro-card" class:complete={micro.complete}>
							<div class="micro-head">
								<span class="micro-index">μ{micro.plan.indexInMeso}</span>
								{#if editMode && plan}
									<button
										type="button"
										class="ghost tiny danger-text"
										onclick={() => handleRemoveMicro(meso.plan.id, micro.plan.id)}
									>
										×
									</button>
								{/if}
								<span class="micro-status" class:ok={micro.complete}>
									{micro.complete ? 'A+B' : 'частично'}
								</span>
							</div>

							{#if micro.intensityByExercise.length > 0}
								<div class="intensity-rows">
									{#each micro.intensityByExercise as row}
										<div class="intensity-row">
											<span class="exercise-col">{shortExerciseName(row.exercise)}</span>
											<span class="muted">1ПМ {fmtNum(row.anchor1rm)} кг</span>
											<span class="muted">
												{row.protocolLabel ? `${row.protocolLabel} · ` : ''}цель {fmtNum(row.targetWeight)}
												кг ({row.targetPct}%)
											</span>
											{#if row.plannedOnly}
												<span class="muted">не было в этот μ</span>
											{:else}
												<span class:match={Math.abs(row.maxPct - row.targetPct) <= 3}>
													факт {fmtNum(row.maxPct)}%
												</span>
											{/if}
										</div>
									{/each}
								</div>
							{:else}
								<p class="muted micro-empty">Нет упражнений с якорным 1ПМ в этом μ</p>
							{/if}

							<div class="cycle-days">
								{#if micro.dayA}
									<a class="day-chip slot-a" href="{base}/?date={micro.dayA.date}">
										<span class="slot">A</span>
										<span>{formatDateRu(micro.dayA.date)}</span>
									</a>
								{/if}
								{#if micro.dayB}
									<a class="day-chip slot-b" href="{base}/?date={micro.dayB.date}">
										<span class="slot">B</span>
										<span>{formatDateRu(micro.dayB.date)}</span>
									</a>
								{/if}
								{#each micro.plan.dates.filter((d) => d !== micro.dayA?.date && d !== micro.dayB?.date) as date}
									<a class="day-chip" href="{base}/?date={date}">
										<span>{formatDateRu(date)}</span>
										{#if editMode && plan}
											<button
												type="button"
												class="unlink"
												onclick={(e) => {
													e.preventDefault();
													handleUnassign(date);
												}}
											>
												×
											</button>
										{/if}
									</a>
								{/each}
							</div>

							{#if editMode && plan && unassigned.length > 0}
								<label class="assign-field">
									<span>Добавить день</span>
									<select
										onchange={(e) => {
											handleAssign(meso.plan.id, micro.plan.id, e.currentTarget.value);
											e.currentTarget.value = '';
										}}
									>
										<option value="">— выбрать —</option>
										{#each unassigned as date}
											<option value={date}>{formatDateRu(date)}</option>
										{/each}
									</select>
								</label>
							{/if}
						</div>
					{/each}
				</div>

				{#if meso.gapAfterDays !== null && meso.gapAfterDays >= 14}
					<p class="gap-note">
						До следующего мезоблока {Math.round(meso.gapAfterDays / 7)} нед.
					</p>
				{/if}
			</article>
		{/each}
	</div>
</section>

<style>
	.intro {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		align-items: start;
	}

	.intro h2,
	.templates h3,
	.toolbar h3,
	.protocol-editor h3,
	.unassigned h3 {
		margin: 0 0 0.25rem;
	}

	.intro-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	button.primary {
		border-radius: 10px;
		padding: 0.5rem 0.85rem;
		border: 1px solid rgba(110, 231, 168, 0.45);
		background: rgba(110, 231, 168, 0.16);
		color: var(--accent);
	}

	button.ghost {
		border-radius: 10px;
		padding: 0.5rem 0.85rem;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
	}

	button.tiny {
		padding: 0.2rem 0.45rem;
		font-size: 0.78rem;
	}

	.danger-text {
		color: var(--danger);
	}

	.protocol-editor {
		display: grid;
		gap: 0.75rem;
	}

	.phase-table {
		display: grid;
		gap: 0.45rem;
	}

	.phase-row {
		display: grid;
		grid-template-columns: 1fr repeat(3, auto);
		gap: 0.5rem;
		align-items: end;
	}

	.phase-row input {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--text);
		padding: 0.4rem 0.55rem;
		min-width: 4rem;
	}

	.phase-row label {
		display: grid;
		gap: 0.15rem;
		font-size: 0.75rem;
		color: var(--muted);
	}

	.protocol-preview {
		display: flex;
		gap: 2px;
		border-radius: 8px;
		overflow: hidden;
		min-height: 2rem;
	}

	.proto-seg {
		display: grid;
		place-content: center;
		text-align: center;
		font-size: 0.72rem;
		background: rgba(167, 139, 250, 0.2);
		border: 1px solid rgba(167, 139, 250, 0.25);
		padding: 0.2rem;
	}

	.proto-seg small {
		color: var(--muted);
		font-size: 0.65rem;
	}

	.template-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.85rem;
		margin-top: 0.85rem;
	}

	.template-card {
		padding: 0.85rem;
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--slot-color) 35%, var(--border));
		background: color-mix(in srgb, var(--slot-color) 8%, var(--surface-2));
	}

	.template-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.35rem;
	}

	.slot-badge {
		display: inline-grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 999px;
		background: var(--slot-color);
		color: #0f1115;
		font-size: 0.85rem;
		font-weight: 800;
	}

	.meta {
		margin: 0.35rem 0 0;
		font-size: 0.82rem;
		color: var(--muted);
	}

	.date-pool {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.5rem;
	}

	.pool-chip {
		font-size: 0.78rem;
		padding: 0.25rem 0.5rem;
		border-radius: 999px;
		border: 1px dashed var(--border);
		color: var(--muted);
	}

	.toolbar {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: end;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}

	.meso-list {
		display: grid;
		gap: 0.85rem;
	}

	.meso-card {
		padding: 0.9rem;
		border-radius: 14px;
		border: 1px solid color-mix(in srgb, var(--meso-color) 40%, var(--border));
		background: color-mix(in srgb, var(--meso-color) 7%, var(--surface-2));
	}

	.meso-head {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		align-items: start;
		margin-bottom: 0.55rem;
	}

	.meso-title {
		margin: 0;
		font-weight: 700;
		color: var(--meso-color);
	}

	.meso-label-input {
		width: 100%;
		max-width: 280px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--text);
		padding: 0.35rem 0.5rem;
		font-weight: 700;
	}

	.meso-sub {
		margin: 0.2rem 0 0;
		font-size: 0.85rem;
	}

	.meso-actions {
		display: flex;
		gap: 0.35rem;
		align-items: center;
	}

	.meso-badge {
		font-size: 0.78rem;
		padding: 0.25rem 0.55rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--meso-color) 45%, var(--border));
		color: var(--meso-color);
		white-space: nowrap;
	}

	.anchors-label {
		color: var(--muted);
		font-size: 0.82rem;
	}

	.exercises-block {
		margin-bottom: 0.55rem;
	}

	.exercises-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.4rem;
	}

	.exercise-rows {
		display: grid;
		gap: 0.35rem;
	}

	.exercise-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.45rem;
		padding: 0.35rem 0.5rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface);
		font-size: 0.8rem;
	}

	.exercise-name {
		min-width: 5rem;
		font-weight: 600;
	}

	.anchor-value {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	.anchor-meta {
		font-size: 0.72rem;
		flex: 1;
		min-width: 8rem;
	}

	.proto-badge {
		font-size: 0.72rem;
		padding: 0.12rem 0.4rem;
		border-radius: 999px;
		background: rgba(167, 139, 250, 0.12);
		color: #c4b5fd;
	}

	.proto-select {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--text);
		padding: 0.2rem 0.35rem;
		font-size: 0.75rem;
		max-width: 160px;
	}

	.anchor-input {
		width: 4rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--text);
		padding: 0.15rem 0.3rem;
	}

	.protocol-editor-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.protocol-editor-head h3 {
		margin: 0;
	}

	.protocol-matrix-wrap {
		overflow-x: auto;
		margin-bottom: 0.75rem;
	}

	.protocol-matrix {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.78rem;
	}

	.protocol-matrix th,
	.protocol-matrix td {
		padding: 0.35rem 0.45rem;
		border: 1px solid var(--border);
		text-align: center;
	}

	.protocol-matrix th:first-child,
	.protocol-matrix td:first-child {
		text-align: left;
		min-width: 5.5rem;
	}

	.protocol-matrix th {
		color: var(--muted);
		font-weight: 600;
		background: var(--surface);
	}

	.protocol-matrix .proto-cell {
		text-align: left;
		color: #c4b5fd;
		font-size: 0.72rem;
		max-width: 7rem;
	}

	.protocol-matrix .pct-cell {
		font-weight: 600;
		color: var(--accent-2);
	}

	.micro-empty {
		margin: 0 0 0.45rem;
		font-size: 0.78rem;
	}

	.exercise-col {
		font-weight: 600;
		min-width: 5rem;
	}

	.micro-list {
		display: grid;
		gap: 0.5rem;
	}

	.micro-card {
		padding: 0.65rem 0.75rem;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--surface);
	}

	.micro-card.complete {
		border-color: rgba(110, 231, 168, 0.22);
	}

	.micro-head {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin-bottom: 0.45rem;
		font-size: 0.82rem;
		flex-wrap: wrap;
	}

	.micro-index {
		font-weight: 800;
		color: var(--muted);
	}

	.micro-status {
		margin-left: auto;
		font-size: 0.75rem;
		color: #fbbf24;
	}

	.micro-status.ok {
		color: var(--accent);
	}

	.intensity-rows {
		display: grid;
		gap: 0.25rem;
		margin-bottom: 0.45rem;
		font-size: 0.78rem;
	}

	.intensity-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.intensity-row .match {
		color: var(--accent);
	}

	.cycle-days {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.day-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.3rem 0.5rem;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		text-decoration: none;
		color: var(--text);
		font-size: 0.8rem;
	}

	.day-chip .slot {
		font-weight: 800;
	}

	.day-chip.slot-a {
		border-color: rgba(91, 157, 255, 0.35);
		background: rgba(91, 157, 255, 0.1);
	}

	.day-chip.slot-b {
		border-color: rgba(110, 231, 168, 0.35);
		background: rgba(110, 231, 168, 0.1);
	}

	.unlink {
		border: none;
		background: transparent;
		color: var(--danger);
		padding: 0;
		cursor: pointer;
		line-height: 1;
	}

	.assign-field {
		display: grid;
		gap: 0.2rem;
		margin-top: 0.45rem;
		font-size: 0.78rem;
		color: var(--muted);
	}

	.assign-field select {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--text);
		padding: 0.35rem 0.5rem;
		max-width: 200px;
	}

	.gap-note {
		margin: 0.65rem 0 0;
		font-size: 0.78rem;
		color: var(--danger);
	}
</style>
