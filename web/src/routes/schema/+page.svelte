<script lang="ts">
	import { countLogsWithoutMicroSession, summarizeLogMicroLinks } from '$lib/data-repair';
	import { repairWorkoutLinksFromData, workoutStore } from '$lib/workout-store';
	import {
		SCHEMA_DIAGRAM,
		SCHEMA_ENTITIES,
		SCHEMA_GROUPS,
		type SchemaEntity
	} from '$lib/schema-docs';

	let activeGroup = $state<(typeof SCHEMA_GROUPS)[number]['id']>('workouts');
	let activeId = $state('workout-database');

	const view = $derived(workoutStore.view);

	const logsWithoutMs = $derived(countLogsWithoutMicroSession(workoutStore.database));
	const microLinkSummary = $derived(summarizeLogMicroLinks(workoutStore.database.logs));
	let repairing = $state(false);

	async function runRepair() {
		repairing = true;
		try {
			await repairWorkoutLinksFromData();
		} finally {
			repairing = false;
		}
	}

	const entitiesInGroup = $derived(
		SCHEMA_ENTITIES.filter((entity) => entity.group === activeGroup)
	);

	const activeEntity = $derived(
		SCHEMA_ENTITIES.find((entity) => entity.id === activeId) ?? SCHEMA_ENTITIES[0]
	);

	function selectGroup(id: (typeof SCHEMA_GROUPS)[number]['id']) {
		activeGroup = id;
		const first = SCHEMA_ENTITIES.find((entity) => entity.group === id);
		if (first) activeId = first.id;
	}

	function selectEntity(entity: SchemaEntity) {
		activeId = entity.id;
		activeGroup = entity.group;
	}

	function scrollTo(id: string) {
		activeId = id;
		const entity = SCHEMA_ENTITIES.find((item) => item.id === id);
		if (entity) activeGroup = entity.group;
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	function relEntityId(label: string): string {
		const base = label.split('.')[0];
		const entity = SCHEMA_ENTITIES.find((item) => item.title === base || item.title === label);
		return entity?.id ?? label.toLowerCase().replace(/\s+/g, '-');
	}
</script>

<section class="card intro">
	<h2>Схемы данных</h2>
	<p class="muted">
		Справочник типов v3: что лежит в JSON, что собирается в памяти, и как сущности связаны между
		собой.
	</p>
	<div class="stats">
		<div class="stat">
			<span class="stat-value">{view.exercises.length}</span>
			<span class="stat-label">упражнений</span>
		</div>
		<div class="stat">
			<span class="stat-value">{view.sessions.length}</span>
			<span class="stat-label">записей (логов)</span>
		</div>
		<div class="stat">
			<span class="stat-value">{view.cyclePlan?.mesocycles.length ?? 0}</span>
			<span class="stat-label">мезо в плане</span>
		</div>
		<div class="stat">
			<span class="stat-value">v{workoutStore.database.version}</span>
			<span class="stat-label">версия БД</span>
		</div>
	</div>
</section>

<section class="card maintenance">
	<h3>Обслуживание данных v3</h3>
	<p class="muted">
		Привязка логов к <code>MicroSessionPlan</code> по дате и слоту A/B. Импорт плана из авто, если
		план пуст.
	</p>
	<div class="maint-stats">
		<span class:warn={logsWithoutMs > 0}>
			Логов без microSessionId: <strong>{logsWithoutMs}</strong> / {microLinkSummary.total}
		</span>
	</div>
	<div class="maint-actions">
		<button type="button" class="primary" disabled={repairing} onclick={runRepair}>
			{repairing ? 'Восстанавливаем…' : 'Восстановить связи логов'}
		</button>
	</div>
	<p class="muted maint-note">
		Импортирует план из авто (если пуст), восстанавливает даты μ, проставляет
		<code>microSessionId</code> по дате и слоту A/B.
	</p>
</section>

<section class="card diagram">
	<h3>Связи</h3>
	<pre class="diagram-pre">{SCHEMA_DIAGRAM}</pre>
	<div class="diagram-legend">
		<span class="badge stored">JSON</span> — хранится на диске
		<span class="badge derived">runtime</span> — вычисляется при загрузке
	</div>
</section>

<div class="layout">
	<aside class="card sidebar">
		<nav class="groups">
			{#each SCHEMA_GROUPS as group (group.id)}
				<button
					type="button"
					class:active={activeGroup === group.id}
					onclick={() => selectGroup(group.id)}
				>
					<span class="group-label">{group.label}</span>
					<span class="group-hint">{group.hint}</span>
				</button>
			{/each}
		</nav>
		<ul class="entity-list">
			{#each entitiesInGroup as entity (entity.id)}
				<li>
					<button
						type="button"
						class:active={activeId === entity.id}
						onclick={() => selectEntity(entity)}
					>
						{entity.title}
						{#if !entity.stored}
							<span class="mini derived">runtime</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
		<p class="muted files-note">
			Файлы: <code>data/workouts.json</code>, <code>data/cycle-plan.json</code>
		</p>
	</aside>

	<div class="content">
		{#each SCHEMA_ENTITIES as entity (entity.id)}
			<article id={entity.id} class="card entity" class:dimmed={activeId !== entity.id}>
				<header class="entity-head">
					<div>
						<h3>{entity.title}</h3>
						<p class="muted">{entity.description}</p>
					</div>
					<div class="badges">
						<span class="badge" class:stored={entity.stored} class:derived={!entity.stored}>
							{entity.stored ? 'JSON' : 'runtime'}
						</span>
						{#if entity.source}
							<span class="source">{entity.source}</span>
						{/if}
					</div>
				</header>

				<div class="table-wrap">
					<table>
						<thead>
							<tr>
								<th>Поле</th>
								<th>Тип</th>
								<th>Описание</th>
							</tr>
						</thead>
						<tbody>
							{#each entity.fields as field (field.name)}
								<tr>
									<td>
										<code>{field.name}</code>
										{#if field.optional}
											<span class="opt">?</span>
										{/if}
									</td>
									<td><code class="type">{field.type}</code></td>
									<td>{field.description}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				{#if entity.relations?.length}
					<div class="relations">
						<span class="rel-label">Связи:</span>
						{#each entity.relations as rel (rel)}
							<button type="button" class="rel-link" onclick={() => scrollTo(relEntityId(rel))}>
								{rel}
							</button>
						{/each}
					</div>
				{/if}

				{#if entity.example}
					<details class="example">
						<summary>Пример JSON</summary>
						<pre>{entity.example}</pre>
					</details>
				{/if}
			</article>
		{/each}
	</div>
</div>

<style>
	.intro h2 {
		margin: 0 0 0.35rem;
	}

	.stats {
		display: flex;
		gap: 1.25rem;
		flex-wrap: wrap;
		margin-top: 1rem;
	}

	.stat {
		display: grid;
		gap: 0.15rem;
	}

	.stat-value {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--accent);
		line-height: 1;
	}

	.stat-label {
		font-size: 0.85rem;
		color: var(--muted);
	}

	.maintenance h3 {
		margin: 0 0 0.35rem;
	}

	.maint-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		margin: 0.85rem 0;
		font-size: 0.9rem;
	}

	.maint-stats .warn {
		color: var(--danger);
	}

	.maint-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	button.primary {
		border-radius: 10px;
		padding: 0.55rem 0.9rem;
		border: 1px solid rgba(110, 231, 168, 0.45);
		background: rgba(110, 231, 168, 0.16);
		color: var(--accent);
		cursor: pointer;
	}

	button.primary:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.maint-note {
		margin: 0.65rem 0 0;
		font-size: 0.85rem;
	}

	.diagram h3 {
		margin: 0 0 0.75rem;
	}

	.diagram-pre {
		margin: 0;
		padding: 1rem 1.1rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 10px;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.78rem;
		line-height: 1.45;
		overflow-x: auto;
		color: var(--accent-2);
	}

	.diagram-legend {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		align-items: center;
		margin-top: 0.75rem;
		font-size: 0.85rem;
		color: var(--muted);
	}

	.layout {
		display: grid;
		grid-template-columns: minmax(220px, 280px) 1fr;
		gap: 1rem;
		align-items: start;
	}

	.sidebar {
		position: sticky;
		top: 1rem;
		padding: 0.75rem;
	}

	.groups {
		display: grid;
		gap: 0.35rem;
		margin-bottom: 0.75rem;
	}

	.groups button {
		text-align: left;
		padding: 0.5rem 0.65rem;
		border-radius: 8px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--text);
		cursor: pointer;
	}

	.groups button:hover,
	.groups button.active {
		background: var(--surface-2);
		border-color: var(--border);
	}

	.groups button.active {
		border-color: rgba(110, 231, 168, 0.35);
	}

	.group-label {
		display: block;
		font-size: 0.9rem;
		font-weight: 600;
	}

	.group-hint {
		display: block;
		font-size: 0.75rem;
		color: var(--muted);
		margin-top: 0.1rem;
	}

	.entity-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.2rem;
	}

	.entity-list button {
		width: 100%;
		text-align: left;
		padding: 0.4rem 0.55rem;
		border-radius: 6px;
		border: none;
		background: transparent;
		color: var(--muted);
		font-size: 0.85rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.35rem;
	}

	.entity-list button:hover,
	.entity-list button.active {
		background: rgba(91, 157, 255, 0.1);
		color: var(--text);
	}

	.entity-list button.active {
		color: var(--accent-2);
	}

	.files-note {
		margin: 0.85rem 0 0;
		font-size: 0.78rem;
	}

	.content {
		display: grid;
		gap: 1rem;
	}

	.entity.dimmed {
		opacity: 0.55;
	}

	.entity:not(.dimmed) {
		border-color: rgba(110, 231, 168, 0.25);
	}

	.entity-head {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}

	.entity-head h3 {
		margin: 0 0 0.25rem;
		font-size: 1.25rem;
	}

	.badges {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.35rem;
	}

	.badge {
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.2rem 0.45rem;
		border-radius: 999px;
		border: 1px solid var(--border);
	}

	.badge.stored {
		color: var(--accent);
		border-color: rgba(110, 231, 168, 0.35);
		background: rgba(110, 231, 168, 0.08);
	}

	.badge.derived {
		color: var(--accent-2);
		border-color: rgba(91, 157, 255, 0.35);
		background: rgba(91, 157, 255, 0.08);
	}

	.mini {
		font-size: 0.65rem;
		padding: 0.1rem 0.3rem;
		border-radius: 4px;
	}

	.mini.derived {
		color: var(--accent-2);
		background: rgba(91, 157, 255, 0.12);
	}

	.source {
		font-size: 0.75rem;
		color: var(--muted);
		font-family: ui-monospace, monospace;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}

	th,
	td {
		text-align: left;
		padding: 0.45rem 0.6rem;
		border-bottom: 1px solid var(--border);
		vertical-align: top;
	}

	th {
		color: var(--muted);
		font-weight: 500;
		font-size: 0.8rem;
	}

	code {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.82em;
	}

	code.type {
		color: var(--accent-2);
	}

	.opt {
		color: var(--muted);
		font-size: 0.75rem;
		margin-left: 0.15rem;
	}

	.relations {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: center;
		margin-top: 0.85rem;
	}

	.rel-label {
		font-size: 0.85rem;
		color: var(--muted);
	}

	.rel-link {
		font-size: 0.82rem;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--accent-2);
		cursor: pointer;
	}

	.example {
		margin-top: 0.85rem;
	}

	.example summary {
		cursor: pointer;
		color: var(--muted);
		font-size: 0.9rem;
		user-select: none;
	}

	.example pre {
		margin: 0.5rem 0 0;
		padding: 0.85rem 1rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 8px;
		font-size: 0.78rem;
		overflow-x: auto;
		line-height: 1.45;
	}

	@media (max-width: 860px) {
		.layout {
			grid-template-columns: 1fr;
		}

		.sidebar {
			position: static;
		}

		.entity.dimmed {
			opacity: 1;
		}
	}
</style>
