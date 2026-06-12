<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { page } from '$app/stores';
  import { getGitHubToken, setGitHubToken } from '$lib/auth';
  import {
    connectGitHub,
    pushToGitHub,
    resetToBundled,
    workoutStore
  } from '$lib/workout-store';
  import { thesesStore } from '$lib/training-theses';

  export let data;

  let settingsOpen = false;
  let token = '';

  const navigation = [
    { href: `${base}/`, route: '/', label: 'Обзор', short: 'Обзор' },
    { href: `${base}/cycles`, route: '/cycles', label: 'План', short: 'План' },
    { href: `${base}/history`, route: '/history', label: 'Журнал', short: 'Журнал' },
    { href: `${base}/stats`, route: '/stats', label: 'Аналитика', short: 'Аналитика' }
  ];

  $: path = $page.url.pathname;
  $: routePath = base && path.startsWith(base) ? path.slice(base.length) || '/' : path;
  $: view = workoutStore.view;
  $: macrocycles = view.cyclePlanView.macrocycles;
  $: mesocycles = view.cyclePlanView.mesocycles;
  $: activeMeso = mesocycles.length ? mesocycles[mesocycles.length - 1] : null;
  $: activeMacro = activeMeso
    ? macrocycles.find((macrocycle) => macrocycle.plan.mesoIds.includes(activeMeso.plan.id)) ?? null
    : null;
  $: activeMicro =
    activeMeso?.microcycles.find((microcycle) => !microcycle.complete) ??
    activeMeso?.microcycles[activeMeso.microcycles.length - 1] ??
    null;
  $: completedSessions = activeMeso
    ? activeMeso.microcycles.reduce(
        (total, microcycle) =>
          total + Number(Boolean(microcycle.dayA)) + Number(Boolean(microcycle.dayB)),
        0
      )
    : 0;
  $: totalSessions = activeMeso
    ? activeMeso.microcycles.length * 2
    : 0;
  $: cycleProgress = totalSessions ? Math.round((completedSessions / totalSessions) * 100) : 0;
  $: sync = workoutStore.sync;
  $: sourceLabel =
    sync.source === 'github'
      ? 'GitHub'
      : token.trim() && sync.source === 'local'
        ? 'Локально · не отправлено'
        : sync.source === 'local'
          ? 'Локальные данные'
          : 'Данные сборки';
  $: pendingGitHubSync = Boolean(token.trim()) && sync.source === 'local' && !sync.syncing;

  onMount(() => {
    workoutStore.bootstrap(data.bundled, data.bundledCyclePlan ?? null);
    thesesStore.bootstrap(data.theses);
    workoutStore.connectIfTokenSaved();
    token = getGitHubToken();
  });

  async function saveSettings() {
    setGitHubToken(token);
    if (!token.trim()) {
      workoutStore.patchSync({
        workoutsSha: null,
        cyclePlanSha: null,
        githubLogin: null,
        syncing: false,
        error: '',
        message: 'GitHub отключён. Данные остаются в браузере.'
      });
      return;
    }
    await connectGitHub(token);
  }

  async function syncNow() {
    if (sync.syncing) return;
    try {
      await pushToGitHub(token);
    } catch {
      // ошибка уже записана в workoutStore.sync.error
    }
  }

  function isActive(route: string) {
    if (route === '/') return routePath === '/';
    return routePath.startsWith(route);
  }
</script>

<svelte:head>
  <title>Gym Planner</title>
  <meta
    name="description"
    content="Личный помощник для планирования макроциклов, мезоциклов и тренировок"
  />
</svelte:head>

<div class="app-shell">
  <aside class="sidebar">
    <a class="brand" href={`${base}/`} aria-label="На главную">
      <span class="brand-mark">GP</span>
      <span>
        <strong>Gym Planner</strong>
        <small>личный тренерский штаб</small>
      </span>
    </a>
    <button
      class="mobile-settings"
      type="button"
      aria-label="Открыть настройки"
      on:click={() => (settingsOpen = true)}
    >
      Настройки
    </button>

    <nav class="primary-nav" aria-label="Основная навигация">
      {#each navigation as item}
        <a href={item.href} class:active={isActive(item.route)}>
          <span class="nav-marker"></span>
          {item.label}
        </a>
      {/each}
    </nav>

    <a class="quick-action" href={`${base}/add`}>
      <span>+</span>
      Записать тренировку
    </a>

    {#if activeMeso}
      <section class="cycle-glance">
        <div class="eyebrow">Текущий блок</div>
        <strong>{activeMeso.plan.label}</strong>
        <span>{activeMacro?.plan.label ?? 'Вне макроцикла'}</span>
        <div class="progress-track" aria-label={`Выполнено ${cycleProgress}%`}>
          <span style={`width: ${cycleProgress}%`}></span>
        </div>
        <div class="cycle-glance-meta">
          <span>{completedSessions} из {totalSessions} тренировок</span>
          <b>{cycleProgress}%</b>
        </div>
        {#if activeMicro}
          <small>Сейчас: микроцикл {activeMicro.plan.indexInMeso}</small>
        {/if}
      </section>
    {/if}

    <div class="sidebar-footer">
      <button class="settings-button" type="button" on:click={() => (settingsOpen = true)}>
        <span>Настройки</span>
        <small>{sourceLabel}</small>
      </button>
    </div>
  </aside>

  <main class="main-content">
    <slot />
  </main>

  <nav class="mobile-nav" aria-label="Мобильная навигация">
    {#each navigation as item}
      <a href={item.href} class:active={isActive(item.route)}>{item.short}</a>
    {/each}
    <a href={`${base}/add`} class:active={routePath.startsWith('/add')}>Запись</a>
  </nav>
</div>

{#if settingsOpen}
  <div
    class="dialog-backdrop"
    role="button"
    tabindex="0"
    aria-label="Закрыть настройки"
    on:click={() => (settingsOpen = false)}
    on:keydown={(event) => event.key === 'Escape' && (settingsOpen = false)}
  >
    <div
      class="settings-panel"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-labelledby="settings-title"
      on:click|stopPropagation
      on:keydown|stopPropagation
    >
      <div class="panel-heading">
        <div>
          <div class="eyebrow">Приложение</div>
          <h2 id="settings-title">Настройки</h2>
        </div>
        <button class="icon-button" type="button" aria-label="Закрыть" on:click={() => (settingsOpen = false)}>
          ×
        </button>
      </div>

      <div class="settings-section">
        <h3>Синхронизация с GitHub</h3>
        <p>
          Необязательно. Без токена данные хранятся только в браузере. С токеном правки сначала
          сохраняются локально, а в репозиторий уходят одной кнопкой «Отправить в GitHub» — так не
          будет лишних деплоев на каждое изменение.
        </p>
        <label>
          Токен
          <input bind:value={token} type="password" autocomplete="off" placeholder="github_pat_..." />
        </label>
        {#if sync.syncing}
          <div class="sync-status busy" role="status" aria-live="polite">
            <span class="sync-spinner" aria-hidden="true"></span>
            {sync.message || 'Отправка в GitHub…'}
          </div>
        {:else if sync.error}
          <div class="sync-status error" role="alert">{sync.error}</div>
        {:else if sync.message}
          <div class="sync-status ok" role="status">{sync.message}</div>
        {/if}
      </div>

      <div class="settings-links">
        <a href={`${base}/schema`} on:click={() => (settingsOpen = false)}>Структура данных</a>
        <a href={`${base}/body`} on:click={() => (settingsOpen = false)}>Карта нагрузки</a>
      </div>

      <div class="panel-actions">
        <button class="button button-danger" type="button" on:click={() => resetToBundled(data.bundled)}>
          Сбросить локальные
        </button>
        {#if token.trim()}
          <button
            class="button {pendingGitHubSync ? 'button-primary' : 'button-secondary'}"
            type="button"
            disabled={sync.syncing}
            aria-busy={sync.syncing}
            on:click={syncNow}
          >
            {#if sync.syncing}
              Отправка…
            {:else}
              Отправить в GitHub
            {/if}
          </button>
        {/if}
        <button
          class="button button-primary"
          type="button"
          disabled={sync.syncing}
          on:click={saveSettings}
        >
          {sync.syncing ? 'Подключение...' : 'Сохранить'}
        </button>
      </div>
    </div>
  </div>
{/if}
