<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { page } from '$app/stores';
  import { getGitHubToken, setGitHubToken } from '$lib/auth';
  import {
    connectGitHub,
    pullFromGitHub,
    pushToGitHub,
    resetToBundled,
    workoutStore
  } from '$lib/workout-store';
  import { thesesStore } from '$lib/training-theses';
  import Toaster from '$lib/components/Toaster.svelte';
  import { toasts } from '$lib/toast.svelte';

  export let data;

  let settingsOpen = false;
  let token = '';

  const navigation = [
    { href: `${base}/`, route: '/', label: 'Обзор', short: 'Обзор' },
    { href: `${base}/cycles`, route: '/cycles', label: 'План', short: 'План' },
    { href: `${base}/protocols`, route: '/protocols', label: 'Протоколы', short: 'Прот.' },
    { href: `${base}/exercises`, route: '/exercises', label: 'Упражнения', short: 'Упр.' },
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

  function closeSettings() {
    settingsOpen = false;
  }

  async function runGitHubAction(pendingMessage: string, action: () => Promise<void>) {
    if (sync.syncing) return;
    closeSettings();
    const pendingId = toasts.info(pendingMessage, undefined, 0);
    try {
      await action();
      toasts.dismiss(pendingId);
      if (workoutStore.sync.error) {
        toasts.error(workoutStore.sync.error);
      } else if (workoutStore.sync.message) {
        toasts.success(workoutStore.sync.message);
      }
    } catch {
      toasts.dismiss(pendingId);
      toasts.error(workoutStore.sync.error || 'Ошибка синхронизации с GitHub');
    }
  }

  async function saveSettings() {
    setGitHubToken(token);
    closeSettings();
    if (!token.trim()) {
      workoutStore.patchSync({
        workoutsSha: null,
        cyclePlanSha: null,
        githubLogin: null,
        syncing: false,
        error: '',
        message: ''
      });
      toasts.info('GitHub отключён. Данные остаются в браузере.');
      return;
    }
    await runGitHubAction('Подключение к GitHub…', () => connectGitHub(token));
  }

  async function syncNow() {
    await runGitHubAction('Отправка в GitHub…', () => pushToGitHub(token));
  }

  async function pullNow() {
    await runGitHubAction('Загрузка из GitHub…', () => pullFromGitHub(token));
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

<Toaster />

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
          сохраняются локально, а в репозиторий уходят кнопкой «Отправить в GitHub». «Подтянуть из
          GitHub» загружает актуальные данные из репозитория и перезаписывает локальные.
        </p>
        <label>
          Токен
          <input bind:value={token} type="password" autocomplete="off" placeholder="github_pat_..." />
        </label>
      </div>

      <div class="settings-links">
        <a href={`${base}/schema`} on:click={() => (settingsOpen = false)}>Структура данных</a>
        <a href={`${base}/body`} on:click={() => (settingsOpen = false)}>Карта нагрузки</a>
      </div>

      <div class="panel-actions">
        <button
          class="button button-danger"
          type="button"
          on:click={() => {
            resetToBundled(data.bundled);
            closeSettings();
            toasts.success(workoutStore.sync.message || 'Локальные данные сброшены.');
          }}
        >
          Сбросить локальные
        </button>
        {#if token.trim()}
          <button
            class="button button-secondary"
            type="button"
            disabled={sync.syncing}
            aria-busy={sync.syncing}
            on:click={pullNow}
          >
            Подтянуть из GitHub
          </button>
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
