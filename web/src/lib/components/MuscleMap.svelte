<script lang="ts">
	import { MOVEMENT_BLOCKS, type MovementBlockId } from '$lib/muscle-groups';

	let {
		activeBlocks = [],
		selected = null,
		onselect
	}: {
		activeBlocks?: MovementBlockId[];
		selected?: MovementBlockId | null;
		onselect?: (id: MovementBlockId) => void;
	} = $props();

	type Zone = {
		id: MovementBlockId;
		d: string;
		label: string;
		labelX: number;
		labelY: number;
	};

	const zones: Zone[] = [
		{
			id: 'vertical_push',
			d: 'M 62 58 Q 100 48 138 58 L 132 88 Q 100 78 68 88 Z',
			label: 'Жим в',
			labelX: 100,
			labelY: 72
		},
		{
			id: 'horizontal_push',
			d: 'M 72 92 Q 100 86 128 92 L 124 132 Q 100 128 76 132 Z',
			label: 'Жим г',
			labelX: 100,
			labelY: 114
		},
		{
			id: 'horizontal_pull',
			d: 'M 48 96 Q 58 108 48 128 Q 42 112 48 96 Z M 152 96 Q 142 108 152 128 Q 158 112 152 96 Z',
			label: 'Тяга г',
			labelX: 34,
			labelY: 112
		},
		{
			id: 'vertical_pull',
			d: 'M 78 132 Q 100 124 122 132 L 118 168 Q 100 162 82 168 Z',
			label: 'Тяга в',
			labelX: 100,
			labelY: 152
		},
		{
			id: 'core',
			d: 'M 82 172 Q 100 166 118 172 L 114 212 Q 100 208 86 212 Z',
			label: 'Кор',
			labelX: 100,
			labelY: 194
		},
		{
			id: 'arms',
			d: 'M 38 92 Q 28 118 32 152 Q 42 148 48 122 Q 46 102 38 92 Z M 162 92 Q 172 118 168 152 Q 158 148 152 122 Q 154 102 162 92 Z',
			label: 'Руки',
			labelX: 24,
			labelY: 132
		},
		{
			id: 'knee_dominant',
			d: 'M 72 214 Q 100 208 128 214 L 122 292 Q 100 288 78 292 Z',
			label: 'Колено',
			labelX: 100,
			labelY: 256
		},
		{
			id: 'hip_dominant',
			d: 'M 76 208 Q 100 202 124 208 L 128 228 Q 100 224 72 228 Z',
			label: 'Таз',
			labelX: 100,
			labelY: 220
		},
		{
			id: 'conditioning',
			d: 'M 78 296 Q 100 292 122 296 L 118 372 Q 100 378 82 372 Z',
			label: 'Кардио',
			labelX: 100,
			labelY: 338
		}
	];

	function blockColor(id: MovementBlockId): string {
		return MOVEMENT_BLOCKS.find((block) => block.id === id)?.color ?? '#94a3b8';
	}

	function zoneFill(id: MovementBlockId): string {
		const color = blockColor(id);
		if (selected === id) return color;
		if (activeBlocks.includes(id)) return `${color}88`;
		return `${color}22`;
	}

	function zoneStroke(id: MovementBlockId): string {
		if (selected === id) return blockColor(id);
		if (activeBlocks.includes(id)) return `${blockColor(id)}aa`;
		return 'rgba(255,255,255,0.08)';
	}

	function handleSelect(id: MovementBlockId) {
		onselect?.(id);
	}

	function handleKeydown(event: KeyboardEvent, id: MovementBlockId) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleSelect(id);
		}
	}
</script>

<div class="map-wrap">
	<svg viewBox="0 0 200 420" class="body-map" role="img" aria-label="Карта блоков движений">
		<ellipse cx="100" cy="30" rx="20" ry="22" class="body-base" />
		<path d="M 88 50 L 84 58 L 116 58 L 112 50 Z" class="body-base" />
		<path
			d="M 78 58 Q 100 52 122 58 L 128 214 Q 100 220 72 214 Z"
			class="body-base body-torso"
		/>
		<path d="M 88 372 L 84 410 L 96 410 L 100 382 L 104 410 L 116 410 L 112 372 Z" class="body-base" />

		{#each zones as zone}
			<g
				class="zone"
				class:selected={selected === zone.id}
				class:active={activeBlocks.includes(zone.id)}
				style="--zone-color: {blockColor(zone.id)}"
				role="button"
				tabindex="0"
				aria-label={MOVEMENT_BLOCKS.find((b) => b.id === zone.id)?.label}
				onclick={() => handleSelect(zone.id)}
				onkeydown={(event) => handleKeydown(event, zone.id)}
			>
				<path
					d={zone.d}
					fill={zoneFill(zone.id)}
					stroke={zoneStroke(zone.id)}
					stroke-width={selected === zone.id ? 2.5 : 1.5}
				/>
			</g>
		{/each}

		{#each zones as zone}
			{#if activeBlocks.includes(zone.id) || selected === zone.id}
				<text x={zone.labelX} y={zone.labelY} class="zone-label">{zone.label}</text>
			{/if}
		{/each}
	</svg>

	<ul class="legend">
		{#each MOVEMENT_BLOCKS as block}
			<li>
				<button
					type="button"
					class="legend-item"
					class:selected={selected === block.id}
					class:active={activeBlocks.includes(block.id)}
					style="--block-color: {block.color}"
					onclick={() => handleSelect(block.id)}
				>
					<span class="swatch"></span>
					<span>{block.label}</span>
					{#if activeBlocks.includes(block.id)}
						<span class="dot"></span>
					{/if}
				</button>
			</li>
		{/each}
	</ul>
</div>

<style>
	.map-wrap {
		display: grid;
		gap: 1rem;
	}

	.body-map {
		width: 100%;
		max-width: 280px;
		margin: 0 auto;
		display: block;
		background:
			radial-gradient(circle at 50% 20%, rgba(110, 231, 168, 0.06), transparent 45%),
			var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 16px;
		padding: 0.5rem;
	}

	.body-base {
		fill: rgba(255, 255, 255, 0.04);
		stroke: rgba(255, 255, 255, 0.1);
		stroke-width: 1;
	}

	.body-torso {
		fill: rgba(255, 255, 255, 0.03);
	}

	.zone {
		cursor: pointer;
		outline: none;
	}

	.zone path {
		transition:
			fill 0.15s ease,
			stroke 0.15s ease,
			filter 0.15s ease;
	}

	.zone:hover path,
	.zone.selected path,
	.zone:focus-visible path {
		filter: drop-shadow(0 0 8px color-mix(in srgb, var(--zone-color) 55%, transparent));
	}

	.zone-label {
		fill: rgba(255, 255, 255, 0.75);
		font-size: 9px;
		text-anchor: middle;
		pointer-events: none;
	}

	.legend {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 0.35rem;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		width: 100%;
		text-align: left;
		padding: 0.4rem 0.55rem;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--muted);
		font-size: 0.82rem;
	}

	.legend-item.active {
		color: var(--text);
	}

	.legend-item.selected {
		border-color: color-mix(in srgb, var(--block-color) 45%, var(--border));
		background: color-mix(in srgb, var(--block-color) 10%, var(--surface-2));
		color: var(--text);
	}

	.swatch {
		width: 10px;
		height: 10px;
		border-radius: 999px;
		background: var(--block-color);
		flex-shrink: 0;
	}

	.dot {
		margin-left: auto;
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: var(--block-color);
	}
</style>
