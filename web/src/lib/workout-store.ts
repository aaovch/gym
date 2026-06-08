import { derived, get, writable } from 'svelte/store';
import { getGitHubToken } from './auth';
import { sessionsToEntries } from './database';
import { fetchWorkoutDatabase, saveWorkoutDatabase, verifyGitHubToken } from './github';
import { buildWorkoutData } from './stats';
import type { WorkoutDatabase, WorkoutSession, WorkoutSnapshot } from './types';

type SyncState = {
	sha: string | null;
	githubLogin: string | null;
	syncing: boolean;
	error: string;
	message: string;
};

function emptyDatabase(): WorkoutDatabase {
	return { version: 1, updatedAt: '', sessions: [] };
}

const database = writable<WorkoutDatabase>(emptyDatabase());
const syncState = writable<SyncState>({
	sha: null,
	githubLogin: null,
	syncing: false,
	error: '',
	message: ''
});

export const workoutView = derived(database, ($database) => {
	const entries = sessionsToEntries($database.sessions);
	const computed = buildWorkoutData(entries);
	return {
		entries,
		summary: computed.summary,
		trend: computed.trend,
		sessions: $database.sessions,
		updatedAt: $database.updatedAt
	};
});

export { syncState };

export function initWorkoutStore(snapshot: WorkoutSnapshot) {
	database.set({
		version: 1,
		updatedAt: snapshot.updatedAt ?? snapshot.generatedAt,
		sessions: snapshot.sessions ?? []
	});
}

export async function connectGitHub(token: string) {
	syncState.update((state) => ({ ...state, syncing: true, error: '', message: '' }));
	try {
		const login = await verifyGitHubToken(token);
		const { db, sha } = await fetchWorkoutDatabase(token);
		database.set(db);
		syncState.set({
			sha,
			githubLogin: login,
			syncing: false,
			error: '',
			message: 'Подключено к GitHub. Данные загружены из репозитория.'
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

async function persistDatabase(token: string, message: string) {
	let sha = get(syncState).sha;
	if (!sha) {
		const remote = await fetchWorkoutDatabase(token);
		sha = remote.sha;
		database.set(remote.db);
	}

	const db = get(database);
	db.updatedAt = new Date().toISOString();
	database.set({ ...db });

	const nextSha = await saveWorkoutDatabase(token, db, sha, message);
	syncState.update((state) => ({
		...state,
		sha: nextSha,
		error: '',
		message: 'Сохранено в GitHub. Сайт обновится через 1–2 минуты.'
	}));
}

export async function saveSession(session: WorkoutSession, token = getGitHubToken()) {
	if (!token) throw new Error('Нужен GitHub token для сохранения');

	const db = get(database);
	const index = db.sessions.findIndex((item) => item.id === session.id);
	const sessions =
		index === -1
			? [...db.sessions, session]
			: db.sessions.map((item) => (item.id === session.id ? session : item));

	database.set({ ...db, sessions });
	await persistDatabase(token, `Update workout: ${session.exercise} (${session.date})`);
}

export async function deleteSession(sessionId: string, token = getGitHubToken()) {
	if (!token) throw new Error('Нужен GitHub token для удаления');

	const db = get(database);
	const target = db.sessions.find((item) => item.id === sessionId);
	database.set({ ...db, sessions: db.sessions.filter((item) => item.id !== sessionId) });
	await persistDatabase(token, `Delete workout: ${target?.exercise ?? sessionId}`);
}

export async function refreshFromGitHub(token = getGitHubToken()) {
	if (!token) throw new Error('Нужен GitHub token');
	await connectGitHub(token);
}
