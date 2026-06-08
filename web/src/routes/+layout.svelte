<script lang="ts">
	import '../app.css';
	import { base } from '$app/paths';
	import { page } from '$app/stores';

	let { children } = $props();

	const tabs = [
		{ href: `${base}/`, label: 'Сегодня', exact: true },
		{ href: `${base}/stats`, label: 'Статистика', exact: false },
		{ href: `${base}/add`, label: 'Добавить', exact: false }
	];
</script>

<div class="shell">
	<header class="container header">
		<div>
			<p class="eyebrow">aaovch / gym</p>
			<h1>План тренировок</h1>
		</div>
		<nav class="tabs">
			{#each tabs as tab}
				<a
					href={tab.href}
					class:active={tab.exact
						? $page.url.pathname === base || $page.url.pathname === `${base}/`
						: $page.url.pathname.startsWith(tab.href)}
				>
					{tab.label}
				</a>
			{/each}
		</nav>
	</header>

	<main class="container main">
		{@render children()}
	</main>
</div>

<style>
	.shell {
		padding: 2rem 0 3rem;
	}

	.header {
		display: flex;
		justify-content: space-between;
		align-items: end;
		gap: 1rem;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	.eyebrow {
		margin: 0 0 0.25rem;
		color: var(--muted);
		font-size: 0.85rem;
	}

	h1 {
		margin: 0;
		font-size: clamp(1.8rem, 4vw, 2.4rem);
	}

	.tabs {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.tabs a {
		text-decoration: none;
		color: var(--text);
		padding: 0.55rem 0.9rem;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface);
	}

	.tabs a.active {
		border-color: rgba(110, 231, 168, 0.45);
		background: rgba(110, 231, 168, 0.12);
		color: var(--accent);
	}

	.main {
		display: grid;
		gap: 1rem;
	}
</style>
