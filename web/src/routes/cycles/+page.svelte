<script lang="ts">
	import { base } from '$app/paths';
	import { formatDateRu } from '$lib/format';
	import { slotColor, slotLabel } from '$lib/microcycle';
	import { workoutView } from '$lib/workout-store';

	const { templates, cycles } = $derived($workoutView.microcycles);
	const completeCount = $derived(cycles.filter((cycle) => cycle.complete).length);
</script>

<section class="card intro">
	<div>
		<h2>Микроциклы</h2>
		<p class="muted">
			Автоопределение двух тренировок A и B по составу упражнений в каждый день. Микроцикл —
			пара A + B подряд (перерыв &gt; 3 нед. начинает новый цикл).
		</p>
	</div>
</section>

<section class="card templates">
	<h3>Шаблоны тренировок</h3>
	<div class="template-grid">
		{#each templates as template}
			<article class="template-card" style="--slot-color: {slotColor(template.slot)}">
				<div class="template-head">
					<span class="slot-badge">{template.slot}</span>
					<strong>{slotLabel(template.slot)}</strong>
				</div>
				<p class="muted">{template.label}</p>
				<p class="meta">{template.sessions} дней в базе</p>
				<ul>
					{#each template.exercises as exercise}
						<li>{exercise}</li>
					{/each}
				</ul>
			</article>
		{/each}
	</div>
</section>

<section class="card">
	<div class="toolbar">
		<h3>История циклов</h3>
		<p class="muted">{cycles.length} циклов · {completeCount} полных (A+B)</p>
	</div>

	<div class="cycle-list">
		{#each [...cycles].reverse() as cycle}
			<article class="cycle-card" class:complete={cycle.complete} class:incomplete={!cycle.complete}>
				<div class="cycle-head">
					<div>
						<p class="cycle-title">Микроцикл #{cycle.index}</p>
						<p class="muted">
							{formatDateRu(cycle.startDate)} — {formatDateRu(cycle.endDate)}
						</p>
					</div>
					<span class="status" class:ok={cycle.complete}>
						{cycle.complete ? 'A + B' : 'неполный'}
					</span>
				</div>

				<div class="cycle-days">
					{#if cycle.dayA}
						<a
							class="day-chip slot-a"
							href="{base}/?date={cycle.dayA.date}"
						>
							<span class="slot">A</span>
							<span>{formatDateRu(cycle.dayA.date)}</span>
						</a>
					{/if}
					{#if cycle.dayB}
						<a
							class="day-chip slot-b"
							href="{base}/?date={cycle.dayB.date}"
						>
							<span class="slot">B</span>
							<span>{formatDateRu(cycle.dayB.date)}</span>
						</a>
					{/if}
					{#each cycle.days.filter((day) => day !== cycle.dayA && day !== cycle.dayB) as day}
						<a
							class="day-chip"
							class:slot-a={day.slot === 'A'}
							class:slot-b={day.slot === 'B'}
							href="{base}/?date={day.date}"
						>
							<span class="slot">{day.slot}</span>
							<span>{formatDateRu(day.date)}</span>
						</a>
					{/each}
				</div>

				{#if cycle.gapAfterDays !== null && cycle.gapAfterDays > 21}
					<p class="gap-note">После цикла перерыв {Math.round(cycle.gapAfterDays / 7)} нед.</p>
				{/if}
			</article>
		{/each}
	</div>
</section>

<style>
	.intro h2,
	.templates h3,
	.toolbar h3 {
		margin: 0 0 0.25rem;
	}

	.template-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
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
		margin: 0.35rem 0 0.5rem;
		font-size: 0.82rem;
		color: var(--muted);
	}

	ul {
		margin: 0;
		padding-left: 1rem;
		color: var(--muted);
		font-size: 0.82rem;
	}

	.toolbar {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: end;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}

	.cycle-list {
		display: grid;
		gap: 0.75rem;
	}

	.cycle-card {
		padding: 0.85rem;
		border-radius: 12px;
		border: 1px solid var(--border);
		background: var(--surface-2);
	}

	.cycle-card.complete {
		border-color: rgba(110, 231, 168, 0.25);
	}

	.cycle-card.incomplete {
		border-color: rgba(251, 191, 36, 0.25);
	}

	.cycle-head {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		align-items: start;
		margin-bottom: 0.65rem;
	}

	.cycle-title {
		margin: 0;
		font-weight: 700;
	}

	.status {
		font-size: 0.78rem;
		padding: 0.25rem 0.5rem;
		border-radius: 999px;
		border: 1px solid rgba(251, 191, 36, 0.35);
		color: #fbbf24;
	}

	.status.ok {
		border-color: rgba(110, 231, 168, 0.35);
		color: var(--accent);
	}

	.cycle-days {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.day-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.55rem;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface);
		text-decoration: none;
		color: var(--text);
		font-size: 0.82rem;
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

	.gap-note {
		margin: 0.55rem 0 0;
		font-size: 0.78rem;
		color: var(--danger);
	}
</style>
