<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import { getGitHubToken, setGitHubToken } from '$lib/auth';
  import {
    pullFromGitHub,
    pushToGitHub,
    resetToBundled,
    workoutStore
  } from '$lib/workout-store';
  import { thesesStore } from '$lib/training-theses';
  import Toaster from '$lib/components/Toaster.svelte';
  import { toasts } from '$lib/toast.svelte';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: Snippet } = $props();

  let settingsOpen = $state(false);
  let token = $state('');

  const navigation = [
    { href: `${base}/`, route: '/', label: 'Обзор', short: 'Обзор' },
    { href: `${base}/cycles`, route: '/cycles', label: 'План', short: 'План' },
    { href: `${base}/protocols`, route: '/protocols', label: 'Протоколы', short: 'Прот.' },
    { href: `${base}/exercises`, route: '/exercises', label: 'Упражнения', short: 'Упр.' },
    { href: `${base}/history`, route: '/history', label: 'Журнал', short: 'Журнал' },
    { href: `${base}/stats`, route: '/stats', label: 'Аналитика', short: 'Аналитика' },
    { href: `${base}/load`, route: '/load', label: 'Нагрузка', short: 'Нагрузка' }
  ];

  const path = $derived(page.url.pathname);
  const routePath = $derived(base && path.startsWith(base) ? path.slice(base.length) || '/' : path);
  const view = $derived(workoutStore.view);
  const macrocycles = $derived(view.cyclePlanView.macrocycles);
  const mesocycles = $derived(view.cyclePlanView.mesocycles);
  const activeMeso = $derived(mesocycles.length ? mesocycles[mesocycles.length - 1] : null);
  const activeMacro = $derived(
    activeMeso
      ? macrocycles.find((macrocycle) => macrocycle.plan.mesoIds.includes(activeMeso.plan.id)) ?? null
      : null
  );
  const activeMicro = $derived(
    activeMeso?.microcycles.find((microcycle) => !microcycle.complete) ??
      activeMeso?.microcycles[activeMeso.microcycles.length - 1] ??
      null
  );
  const completedSessions = $derived(
    activeMeso
      ? activeMeso.microcycles.reduce(
          (total, microcycle) =>
            total + Number(Boolean(microcycle.dayA)) + Number(Boolean(microcycle.dayB)),
          0
        )
      : 0
  );
  const totalSessions = $derived(activeMeso ? activeMeso.microcycles.length * 2 : 0);
  const cycleProgress = $derived(
    totalSessions ? Math.round((completedSessions / totalSessions) * 100) : 0
  );
  const sync = $derived(workoutStore.sync);
  const sourceLabel = $derived(
    sync.source === 'github'
      ? 'GitHub'
      : token.trim() && sync.source === 'local'
        ? 'Локально · не отправлено'
        : sync.source === 'local'
          ? 'Локальные данные'
          : 'Данные сборки'
  );
  const pendingGitHubSync = $derived(Boolean(token.trim()) && sync.source === 'local' && !sync.syncing);

  onMount(() => {
    workoutStore.bootstrap(data.bundled, data.bundledCyclePlan ?? null);
    thesesStore.bootstrap(data.theses);
    workoutStore.connectIfTokenSaved();
    token = getGitHubToken();
  });

  function persistToken(): boolean {
    const trimmed = token.trim();
    setGitHubToken(trimmed);
    if (!trimmed) {
      workoutStore.patchSync({
        workoutsSha: null,
        cyclePlanSha: null,
        githubLogin: null,
        syncing: false,
        error: '',
        message: ''
      });
      return false;
    }
    return true;
  }

  function closeSettings(notifyDisconnect = false) {
    const hadToken = Boolean(getGitHubToken());
    persistToken();
    settingsOpen = false;
    if (notifyDisconnect && hadToken && !token.trim()) {
      toasts.info('GitHub отключён. Данные остаются в браузере.');
    }
  }

  async function runGitHubAction(pendingMessage: string, action: () => Promise<void>) {
    if (sync.syncing) return;
    if (!token.trim()) {
      closeSettings(true);
      toasts.error('Введите токен GitHub');
      return;
    }
    persistToken();
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

  async function syncNow() {
    await runGitHubAction('Отправка в GitHub…', () => pushToGitHub(token.trim()));
  }

  async function pullNow() {
    await runGitHubAction('Загрузка из GitHub…', () => pullFromGitHub(token.trim()));
  }

  function isActive(route: string) {
    if (route === '/') return routePath === '/';
    return routePath.startsWith(route);
  }

  function stopPropagation(event: Event) {
    event.stopPropagation();
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
      onclick={() => (settingsOpen = true)}
    >
      Настройки
    </button>

    <nav class="primary-nav" aria-label="Основная навигация">
      {#each navigation as item (item.route)}
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
          <span style:width="{cycleProgress}%"></span>
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
      <button class="settings-button" type="button" onclick={() => (settingsOpen = true)}>
        <span>Настройки</span>
        <small>{sourceLabel}</small>
      </button>
    </div>
  </aside>

  <main class="main-content">
    {@render children()}
  </main>

  <nav class="mobile-nav" aria-label="Мобильная навигация">
    {#each navigation as item (item.route)}
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
    onclick={() => closeSettings(true)}
    onkeydown={(event) => event.key === 'Escape' && closeSettings(true)}
  >
    <div
      class="settings-panel"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-labelledby="settings-title"
      onclick={stopPropagation}
      onkeydown={stopPropagation}
    >
      <div class="panel-heading">
        <div>
          <div class="eyebrow">Приложение</div>
          <h2 id="settings-title">Настройки</h2>
        </div>
        <button class="icon-button" type="button" aria-label="Закрыть" onclick={() => closeSettings(true)}>
          ×
        </button>
      </div>

      <div class="settings-section">
        <h3>Синхронизация с GitHub</h3>
        <p>
          Необязательно. Без токена данные хранятся только в браузере. Токен сохраняется при
          закрытии настроек. «Подтянуть из GitHub» загружает данные из репозитория, «Отправить в
          GitHub» — отправляет локальные правки.
        </p>
        <label>
          Токен
          <input bind:value={token} type="password" autocomplete="off" placeholder="github_pat_..." />
        </label>
      </div>

      <div class="settings-links">
        <a href={`${base}/schema`} onclick={() => closeSettings()}>Структура данных</a>
        <a href={`${base}/body`} onclick={() => closeSettings()}>Карта нагрузки</a>
      </div>

      <div class="panel-actions">
        <button
          class="button button-danger"
          type="button"
          onclick={() => {
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
            onclick={pullNow}
          >
            Подтянуть из GitHub
          </button>
          <button
            class="button {pendingGitHubSync ? 'button-primary' : 'button-secondary'}"
            type="button"
            disabled={sync.syncing}
            aria-busy={sync.syncing}
            onclick={syncNow}
          >
            {#if sync.syncing}
              Отправка…
            {:else}
              Отправить в GitHub
            {/if}
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}
