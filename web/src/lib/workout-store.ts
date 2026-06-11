import { derived, get, writable } from 'svelte/store';
import { getGitHubToken } from './auth';
import {
	autoMesocyclesAsView,
	buildCyclePlanView,
	importPlanFromAuto,
	refreshAllMesoAnchors,
	type CyclePlan
} from './cycle-plan';
import { DEFAULT_PROTOCOL_TEMPLATE, STABLE_PROTOCOL_TEMPLATE } from './protocol';
import { sessionsToEntries } from './database';
import { fetchWorkoutDatabase, saveWorkoutDatabase, verifyGitHubToken } from './github';
import {
	clearCyclePlan,
	clearLocalDatabase,
	loadCyclePlan,
	loadLocalDatabase,
	pickNewerDatabase,
	saveCyclePlan,
	saveLocalDatabase
} from './storage';
import { buildWorkoutData } from './stats';
import { buildMicrocycleOverview } from './microcycle';
import type { WorkoutDatabase, WorkoutSession } from './types';

type SyncState = {
	sha: string | null;
	githubLogin: string | null;
	syncing: boolean;
	error: string;
	message: string;
	source: 'bundled' | 'local' | 'github';
};

function emptyDatabase(): WorkoutDatabase {
	return { version: 1, updatedAt: '', sessions: [] };
}

const database = writable<WorkoutDatabase>(emptyDatabase());
const cyclePlan = writable<CyclePlan | null>(loadCyclePlan());
const syncState = writable<SyncState>({
	sha: null,
	githubLogin: null,
	syncing: false,
	error: '',
	message: '',
	source: 'bundled'
});

export const workoutView = derived([database, cyclePlan], ([$database, $cyclePlan]) => {
	const entries = sessionsToEntries($database.sessions);
	const computed = buildWorkoutData(entries);
	const microcycles = buildMicrocycleOverview($database.sessions);
	const allDates = [...new Set(entries.map((entry) => entry.date))].sort();
	const cyclePlanView = buildCyclePlanView($cyclePlan, microcycles, entries, allDates);
	const mesocycles =
		cyclePlanView.usingManualPlan && cyclePlanView.mesocycles.length > 0
			? cyclePlanView.mesocycles
			: autoMesocyclesAsView(microcycles, entries);
	const cyclePlanForCalc: CyclePlan =
		$cyclePlan ?? {
			version: 1,
			updatedAt: '',
			templates: [structuredClone(DEFAULT_PROTOCOL_TEMPLATE), structuredClone(STABLE_PROTOCOL_TEMPLATE)],
			mesocycles: []
		};

	return {
		entries,
		summary: computed.summary,
		trend: computed.trend,
		sessions: $database.sessions,
		updatedAt: $database.updatedAt,
		microcycles,
		cyclePlan: $cyclePlan,
		cyclePlanForCalc,
		cyclePlanView: { ...cyclePlanView, mesocycles },
		allDates
	};
});

export { syncState };

function applyDatabase(db: WorkoutDatabase, source: SyncState['source']) {
	database.set(db);
	syncState.update((state) => ({ ...state, source }));
}

function persistLocally(db: WorkoutDatabase) {
	const next = { ...db, updatedAt: new Date().toISOString() };
	database.set(next);
	saveLocalDatabase(next);
	syncState.update((state) => ({
		...state,
		source: state.source === 'github' ? 'github' : 'local'
	}));
	return next;
}

export function bootstrapWorkoutStore(bundled: WorkoutDatabase) {
	const local = loadLocalDatabase();
	const initial = pickNewerDatabase(bundled, local);
	applyDatabase(initial, local && Date.parse(local.updatedAt) > Date.parse(bundled.updatedAt || '0') ? 'local' : 'bundled');
}

export async function connectGitHub(token: string) {
	syncState.update((state) => ({ ...state, syncing: true, error: '', message: '' }));
	try {
		const login = await verifyGitHubToken(token);
		const { db: remote, sha } = await fetchWorkoutDatabase(token);
		const local = loadLocalDatabase();
		const current = get(database);
		const best = [current, local, remote]
			.filter((item): item is WorkoutDatabase => item !== null)
			.reduce((winner, item) => pickNewerDatabase(winner, item));

		applyDatabase(best, best === remote ? 'github' : get(syncState).source);
		saveLocalDatabase(best);

		syncState.set({
			sha,
			githubLogin: login,
			syncing: false,
			error: '',
			message:
				best === remote
					? 'Подключено к GitHub. Загружены данные из репозитория.'
					: 'Подключено к GitHub. Локальные данные новее — при сохранении отправятся в репозиторий.',
			source: best === remote ? 'github' : 'local'
		});
	} catch (error) {
		syncState.update((state) => ({
			...state,
			syncing: false,
			error: error instanceof Error ? error.message : 'Ошибка подключения к GitHub'
		}));
		throw error;
	}
}

async function persistToGitHub(token: string, db: WorkoutDatabase, message: string) {
	let sha = get(syncState).sha;
	if (!sha) {
		const remote = await fetchWorkoutDatabase(token);
		sha = remote.sha;
	}

	const nextSha = await saveWorkoutDatabase(token, db, sha, message);
	syncState.update((state) => ({
		...state,
		sha: nextSha,
		source: 'github',
		error: '',
		message: 'Сохранено в GitHub. Сайт обновится через 1–2 минуты.'
	}));
}

async function persistDatabase(message: string) {
	const db = persistLocally(get(database));
	const token = getGitHubToken();
	if (token) {
		await persistToGitHub(token, db, message);
	} else {
		syncState.update((state) => ({
			...state,
			error: '',
			message: 'Сохранено локально в браузере.'
		}));
	}
}

export async function saveSession(session: WorkoutSession) {
	const db = get(database);
	const index = db.sessions.findIndex((item) => item.id === session.id);
	const sessions =
		index === -1
			? [...db.sessions, session]
			: db.sessions.map((item) => (item.id === session.id ? session : item));

	database.set({ ...db, sessions });
	await persistDatabase(`Update workout: ${session.exercise} (${session.date})`);
}

export async function deleteSession(sessionId: string) {
	const db = get(database);
	const target = db.sessions.find((item) => item.id === sessionId);
	database.set({ ...db, sessions: db.sessions.filter((item) => item.id !== sessionId) });
	await persistDatabase(`Delete workout: ${target?.exercise ?? sessionId}`);
}

export async function refreshFromGitHub(token = getGitHubToken()) {
	if (!token) throw new Error('Нужен GitHub token');
	await connectGitHub(token);
}

export async function pushToGitHub(token = getGitHubToken()) {
	if (!token) throw new Error('Нужен GitHub token');
	const db = get(database);
	await persistToGitHub(token, db, 'Sync workouts from app');
}

export function resetToBundled(bundled: WorkoutDatabase) {
	clearLocalDatabase();
	clearCyclePlan();
	cyclePlan.set(null);
	applyDatabase(bundled, 'bundled');
	syncState.update((state) => ({
		...state,
		message: 'Локальные данные сброшены. Загружена версия с сайта.',
		error: ''
	}));
}

function persistCyclePlan(plan: CyclePlan) {
	const next = { ...plan, updatedAt: new Date().toISOString() };
	cyclePlan.set(next);
	saveCyclePlan(next);
}

export function importCyclePlanFromAuto() {
	const view = get(workoutView);
	const plan = importPlanFromAuto(view.microcycles, view.entries, get(cyclePlan));
	persistCyclePlan(plan);
	syncState.update((state) => ({
		...state,
		message: 'План циклов импортирован из автоопределения. Можно редактировать.',
		error: ''
	}));
}

export function saveCyclePlanState(plan: CyclePlan) {
	persistCyclePlan(plan);
}

export function refreshMesoAnchorsFromData(keepManual = true) {
	const plan = get(cyclePlan);
	if (!plan) return;
	const entries = get(workoutView).entries;
	persistCyclePlan(refreshAllMesoAnchors(plan, entries, keepManual));
	syncState.update((state) => ({
		...state,
		message: keepManual
			? '1ПМ пересчитаны из данных (ручные значения сохранены).'
			: '1ПМ пересчитаны из данных (включая ручные).',
		error: ''
	}));
}

export function clearCyclePlanState() {
	clearCyclePlan();
	cyclePlan.set(null);
	syncState.update((state) => ({
		...state,
		message: 'Ручной план сброшен. Снова используется автоопределение.',
		error: ''
	}));
}
