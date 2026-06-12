import {
	parseCyclePlan,
	parseWorkoutDatabase,
	serializeCyclePlan,
	serializeWorkoutDatabase
} from './storage';
import type { CyclePlan } from './cycle-plan';
import type { WorkoutDatabase } from './types';

export const GITHUB_OWNER = 'aaovch';
export const GITHUB_REPO = 'gym';
export const WORKOUTS_PATH = 'data/workouts.json';
export const CYCLE_PLAN_PATH = 'data/cycle-plan.json';

const API = 'https://api.github.com';

function authHeaders(token: string): HeadersInit {
	return {
		Authorization: `Bearer ${token}`,
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28'
	};
}

function utf8ToBase64(text: string): string {
	return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

function base64ToUtf8(base64: string): string {
	const binary = atob(base64.replace(/\n/g, ''));
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

async function fetchRepoFile(token: string, path: string): Promise<{ content: string; sha: string } | null> {
	const response = await fetch(
		`${API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(path)}`,
		{ headers: authHeaders(token) }
	);

	if (response.status === 404) return null;
	if (!response.ok) {
		const error = await response.json().catch(() => ({}));
		if (response.status === 409) {
			throw new Error('Конфликт синхронизации: файл в GitHub уже изменён. Обновите данные и повторите сохранение.');
		}
		throw new Error((error as { message?: string }).message ?? `GitHub API error ${response.status}`);
	}

	const payload = await response.json();
	return {
		content: base64ToUtf8(payload.content as string),
		sha: payload.sha as string
	};
}

async function saveRepoFile(
	token: string,
	path: string,
	content: string,
	sha: string | null,
	message: string
): Promise<string> {
	const body: Record<string, string> = {
		message,
		content: utf8ToBase64(content)
	};
	if (sha) body.sha = sha;

	const response = await fetch(
		`${API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(path)}`,
		{
			method: 'PUT',
			headers: {
				...authHeaders(token),
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(body)
		}
	);

	if (!response.ok) {
		const error = await response.json().catch(() => ({}));
		throw new Error((error as { message?: string }).message ?? `GitHub API error ${response.status}`);
	}

	const payload = await response.json();
	return payload.content.sha as string;
}

export async function verifyGitHubToken(token: string): Promise<string> {
	const response = await fetch(`${API}/user`, { headers: authHeaders(token) });
	if (!response.ok) {
		throw new Error('Не удалось проверить токен GitHub');
	}
	const user = await response.json();
	return user.login as string;
}

export async function fetchWorkoutDatabase(
	token: string
): Promise<{ db: WorkoutDatabase; sha: string }> {
	const file = await fetchRepoFile(token, WORKOUTS_PATH);
	if (!file) throw new Error('workouts.json не найден в репозитории');
	return { db: parseWorkoutDatabase(file.content), sha: file.sha };
}

export async function saveWorkoutDatabase(
	token: string,
	db: WorkoutDatabase,
	sha: string,
	message: string
): Promise<string> {
	return saveRepoFile(token, WORKOUTS_PATH, serializeWorkoutDatabase(db), sha, message);
}

export async function fetchCyclePlan(
	token: string
): Promise<{ plan: CyclePlan | null; sha: string | null }> {
	const file = await fetchRepoFile(token, CYCLE_PLAN_PATH);
	if (!file) return { plan: null, sha: null };
	return { plan: parseCyclePlan(file.content), sha: file.sha };
}

export async function saveCyclePlanRemote(
	token: string,
	plan: CyclePlan,
	sha: string | null,
	message: string
): Promise<string> {
	return saveRepoFile(token, CYCLE_PLAN_PATH, serializeCyclePlan(plan), sha, message);
}

/** @deprecated use WORKOUTS_PATH */
export const DATA_PATH = WORKOUTS_PATH;
