<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { toasts } from '$lib/toast.svelte';
</script>

<div class="toaster" role="region" aria-live="polite" aria-label="Уведомления">
	{#each toasts.items as toast (toast.id)}
		<div
			class="toast {toast.kind}"
			animate:flip={{ duration: 220 }}
			in:fly={{ y: 16, duration: 220 }}
			out:fade={{ duration: 160 }}
		>
			<span class="bar" aria-hidden="true"></span>
			<span class="msg">{toast.message}</span>
			{#if toast.action}
				<button type="button" class="action" onclick={() => toasts.runAction(toast.id)}>
					{toast.action.label}
				</button>
			{/if}
			<button
				type="button"
				class="close"
				aria-label="Закрыть"
				onclick={() => toasts.dismiss(toast.id)}
			>
				×
			</button>
		</div>
	{/each}
</div>

<style>
	.toaster {
		position: fixed;
		inset: auto 18px 18px auto;
		z-index: 200;
		display: grid;
		gap: 8px;
		width: min(380px, calc(100vw - 36px));
		pointer-events: none;
	}

	.toast {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 12px 12px 16px;
		background: linear-gradient(150deg, #1c1f26, #131419);
		border: 1px solid var(--line-strong);
		box-shadow: var(--shadow);
		pointer-events: auto;
	}

	.bar {
		position: absolute;
		inset: 0 auto 0 0;
		width: 4px;
		background: var(--accent);
	}

	.toast {
		position: relative;
	}

	.toast.error .bar {
		background: var(--danger);
	}

	.toast.info .bar {
		background: var(--blue);
	}

	.msg {
		flex: 1;
		min-width: 0;
		font-size: 13px;
		line-height: 1.35;
	}

	.action {
		flex: 0 0 auto;
		padding: 6px 11px;
		color: var(--accent-ink);
		background: var(--accent);
		border: 0;
		border-radius: 0;
		cursor: pointer;
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.action:hover {
		background: var(--accent-strong);
	}

	.close {
		flex: 0 0 auto;
		width: 24px;
		height: 24px;
		display: grid;
		place-items: center;
		color: var(--muted);
		background: transparent;
		border: 0;
		cursor: pointer;
		font-size: 18px;
		line-height: 1;
	}

	.close:hover {
		color: var(--text);
	}

	@media (max-width: 760px) {
		.toaster {
			inset: auto 12px calc(78px + env(safe-area-inset-bottom)) 12px;
			width: auto;
		}
	}
</style>
