<script lang="ts">
	import { fmtNum, formatDateRu } from '$lib/format';

	type Props = {
		anchor: number;
		current?: number | null;
		currentDate?: string | null;
		stacked?: boolean;
	};

	let { anchor, current = null, currentDate = null, stacked = false }: Props = $props();

	const currentTitle = $derived(
		currentDate
			? `Текущий 1ПМ — лучший за всю историю · сет ${formatDateRu(currentDate)}`
			: 'Текущий 1ПМ — лучший за всю историю (Эпли)'
	);
</script>

<span class="rm-pair" class:stacked>
	<span class="rm-tag anchor" title="Якорный 1ПМ — фиксирован на старт мезо, основа плана % и кг">
		<span class="rm-kind">якорь</span>
		<strong>{fmtNum(anchor)}</strong>
	</span>
	{#if current != null}
		<span class="rm-tag current" title={currentTitle}>
			<span class="rm-kind">текущ.</span>
			<strong>{fmtNum(current)}</strong>
		</span>
	{/if}
</span>

<style>
	.rm-pair {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: center;
	}

	.rm-pair.stacked {
		flex-direction: column;
		align-items: flex-start;
		gap: 0.2rem;
	}

	.rm-tag {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
		padding: 0.12rem 0.4rem;
		border-radius: 999px;
		border: 1px solid var(--border);
		font-size: 0.72rem;
		line-height: 1.2;
		white-space: nowrap;
	}

	.rm-kind {
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted);
	}

	.rm-tag strong {
		font-size: 0.78rem;
		font-weight: 700;
	}

	.rm-tag.anchor {
		border-color: rgba(196, 181, 253, 0.35);
		background: rgba(196, 181, 253, 0.08);
	}

	.rm-tag.anchor strong {
		color: #c4b5fd;
	}

	.rm-tag.current {
		border-color: rgba(110, 231, 168, 0.35);
		background: rgba(110, 231, 168, 0.08);
	}

	.rm-tag.current strong {
		color: var(--accent);
	}
</style>
