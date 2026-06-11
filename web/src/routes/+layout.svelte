<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/stores';
	import { getGitHubToken, setGitHubToken } from '$lib/auth';
	import {
		bootstrapWorkoutStore,
		connectGitHub,
		pushToGitHub,
		resetToBundled,
		syncState
	} from '$lib/workout-store';

	let { data, children } = $props();

	let githubToken = $state(getGitHubToken());
	let showSettings = $state(false);

	bootstrapWorkoutStore(data.bundled);

	const sourceLabel = $derived(
		$syncState.source === 'github'
			? 'GitHub'
			: $syncState.source === 'local'
				? 'локально в браузере'
				: 'сборка сайта'
	);

	onMount(async () => {
		const token = getGitHubToken();
		if (token) {
			try {
				await connectGitHub(token);
			} catch {
				// keep bundled snapshot
			}
		}
	});

	const tabs = [
		{ href: `${base}/`, label: 'Сегодня', exact: true },
		{ href: `${base}/body`, label: 'Карта', exact: false },
		{ href: `${base}/history`, label: 'История', exact: false },
		{ href: `${base}/stats`, label: 'Статистика', exact: false },
		{ href: `${base}/add`, label: 'Запись', exact: false }
	];

	async function saveToken() {
		setGitHubToken(githubToken);
		if (!githubToken.trim()) {
			syncState.update((state) => ({
				...state,
				sha: null,
				githubLogin: null,
				syncing: false,
				error: '',
				message: 'Token удалён. Данные остаются в браузере.'
			}));
			return;
		}
		await connectGitHub(githubToken);
	}

	async function syncNow() {
		await pushToGitHub(githubToken);
	}
</script>

<div class="shell">
	<header class="container header">
		<div>
			<p class="eyebrow">aaovch / gym</p>
			<h1>План тренировок</h1>
			<p class="sync-note">Данные: {sourceLabel}{#if $syncState.githubLogin} · {$syncState.githubLogin}{/if}</p>
		</div>
		<div class="header-side">
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
			<button type="button" class="ghost" onclick={() => (showSettings = !showSettings)}>
				{showSettings ? 'Скрыть' : 'GitHub'}
			</button>
		</div>
	</header>

	{#if showSettings}
		<section class="container card settings">
			<h2>Синхронизация</h2>
			<p class="muted">
				Все тренировки хранятся в JSON. Приложение сохраняет их локально в браузере. GitHub token
				нужен только чтобы отправить копию в <code>data/workouts.json</code> репозитория и обновить
				сайт. Fine-grained token: Contents Read and write для <code>aaovch/gym</code>, или classic
				<code>repo</code>.
			</p>
			<div class="settings-row">
				<input type="password" bind:value={githubToken} placeholder="github_pat_..." />
				<button type="button" class="primary" onclick={saveToken} disabled={$syncState.syncing}>
					{$syncState.syncing ? 'Подключаем...' : 'Сохранить token'}
				</button>
				{#if githubToken.trim()}
					<button type="button" class="ghost" onclick={syncNow} disabled={$syncState.syncing}>
						Отправить в GitHub
					</button>
				{/if}
				<button type="button" class="ghost" onclick={() => resetToBundled(data.bundled)}>
					Сбросить локальные
				</button>
			</div>
			{#if $syncState.message}
				<p class="success">{$syncState.message}</p>
			{/if}
			{#if $syncState.error}
				<p class="error">{$syncState.error}</p>
			{/if}
		</section>
	{/if}

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
		gap: 1rem;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	.header-side {
		display: grid;
		gap: 0.75rem;
		justify-items: end;
	}

	.eyebrow {
		margin: 0 0 0.25rem;
		color: var(--muted);
		font-size: 0.85rem;
	}

	.sync-note {
		margin: 0.35rem 0 0;
		color: var(--accent-2);
		font-size: 0.9rem;
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

	.tabs a,
	button.ghost {
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

	.settings h2 {
		margin: 0 0 0.5rem;
	}

	.settings-row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 1rem;
	}

	.settings-row input {
		flex: 1;
		min-width: 220px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 10px;
		color: var(--text);
		padding: 0.55rem 0.75rem;
	}

	button.primary {
		border-radius: 10px;
		padding: 0.55rem 0.9rem;
		border: 1px solid rgba(110, 231, 168, 0.45);
		background: rgba(110, 231, 168, 0.16);
		color: var(--accent);
	}

	.success {
		color: var(--accent);
		margin: 0.75rem 0 0;
	}

	.error {
		color: var(--danger);
		margin: 0.75rem 0 0;
	}

	.main {
		display: grid;
		gap: 1rem;
	}
</style>
