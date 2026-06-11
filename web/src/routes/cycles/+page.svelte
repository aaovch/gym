<script lang="ts">
	import { base } from '$app/paths';
	import { formatDateRu } from '$lib/format';
	import {
		MESOCYCLE_TARGET_MICROS,
		mesocycleColor,
		slotColor,
		slotLabel
	} from '$lib/microcycle';
	import { workoutView } from '$lib/workout-store';

	const { templates, mesocycles } = $derived($workoutView.microcycles);
	const microCount = $derived(mesocycles.reduce((sum, meso) => sum + meso.microcycles.length, 0));
</script>

<section class="card intro">
	<div>
		<h2>Мезо- и микроциклы</h2>
		<p class="muted">
			<strong>Микроцикл</strong> — пара тренировок A + B. <strong>Мезоцикл</strong> — блок из
			нескольких микроциклов (~{MESOCYCLE_TARGET_MICROS} полных), новый начинается после длинного
			перерыва (&gt; 2 нед.), смены блока или ~6 недель тренировок.
		</p>
	</div>
</section>

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

<section class="card">
	<div class="toolbar">
		<h3>История блоков</h3>
		<p class="muted">{mesocycles.length} мезоциклов · {microCount} микроциклов</p>
	</div>

	<div class="meso-list">
		{#each [...mesocycles].reverse() as meso}
			<article
				class="meso-card"
				style="--meso-color: {mesocycleColor(meso.index)}"
			>
				<div class="meso-head">
					<div>
						<p class="meso-title">Мезоцикл #{meso.index}</p>
						<p class="muted meso-sub">
							{formatDateRu(meso.startDate)} — {formatDateRu(meso.endDate)}
							· {meso.durationDays} дн.
							· {meso.label}
						</p>
					</div>
					<span class="meso-badge">
						{meso.completeMicrocycles}/{meso.microcycles.length} микро
					</span>
				</div>

				<div class="micro-list">
					{#each meso.microcycles as micro}
						<div class="micro-card" class:complete={micro.complete}>
							<div class="micro-head">
								<span class="micro-index">μ{micro.indexInMeso}</span>
								<span class="muted">
									{formatDateRu(micro.startDate)} — {formatDateRu(micro.endDate)}
								</span>
								<span class="micro-status" class:ok={micro.complete}>
									{micro.complete ? 'A+B' : 'частично'}
								</span>
							</div>
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
							</div>
						</div>
					{/each}
				</div>

				{#if meso.gapAfterDays !== null && meso.gapAfterDays >= 14}
					<p class="gap-note">
						До следующего мезоблока {meso.gapAfterDays >= 14
							? `${Math.round(meso.gapAfterDays / 7)} нед.`
							: `${meso.gapAfterDays} дн.`}
					</p>
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
		margin-bottom: 0.75rem;
	}

	.meso-title {
		margin: 0;
		font-weight: 700;
		color: var(--meso-color);
	}

	.meso-sub {
		margin: 0.2rem 0 0;
		font-size: 0.85rem;
	}

	.meso-badge {
		font-size: 0.78rem;
		padding: 0.25rem 0.55rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--meso-color) 45%, var(--border));
		color: var(--meso-color);
		white-space: nowrap;
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
		gap: 0.5rem;
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

	.gap-note {
		margin: 0.65rem 0 0;
		font-size: 0.78rem;
		color: var(--danger);
	}
</style>
