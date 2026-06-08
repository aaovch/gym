import type { WorkoutDatabase } from './types';

export const GITHUB_OWNER = 'aaovch';
export const GITHUB_REPO = 'gym';
export const DATA_PATH = 'data/workouts.json';

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
	const response = await fetch(
		`${API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(DATA_PATH)}`,
		{ headers: authHeaders(token) }
	);

	if (!response.ok) {
		const error = await response.json().catch(() => ({}));
		throw new Error(error.message ?? `GitHub API error ${response.status}`);
	}

	const payload = await response.json();
	return {
		db: JSON.parse(base64ToUtf8(payload.content)) as WorkoutDatabase,
		sha: payload.sha
	};
}

export async function saveWorkoutDatabase(
	token: string,
	db: WorkoutDatabase,
	sha: string,
	message: string
): Promise<string> {
	const response = await fetch(
		`${API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(DATA_PATH)}`,
		{
			method: 'PUT',
			headers: {
				...authHeaders(token),
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				message,
				content: utf8ToBase64(JSON.stringify(db, null, 2)),
				sha
			})
		}
	);

	if (!response.ok) {
		const error = await response.json().catch(() => ({}));
		throw new Error(error.message ?? `GitHub API error ${response.status}`);
	}

	const payload = await response.json();
	return payload.content.sha as string;
}
