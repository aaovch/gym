export const GITHUB_OWNER = 'aaovch';
export const GITHUB_REPO = 'gym';
export const MARKDOWN_PATH = 'План тренировок в качалке.md';

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

export async function fetchMarkdownFile(token: string): Promise<{ content: string; sha: string }> {
	const response = await fetch(
		`${API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(MARKDOWN_PATH)}`,
		{ headers: authHeaders(token) }
	);

	if (!response.ok) {
		const error = await response.json().catch(() => ({}));
		throw new Error(error.message ?? `GitHub API error ${response.status}`);
	}

	const payload = await response.json();
	return {
		content: base64ToUtf8(payload.content),
		sha: payload.sha
	};
}

export async function commitMarkdownFile(
	token: string,
	content: string,
	sha: string,
	message: string
): Promise<void> {
	const response = await fetch(
		`${API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(MARKDOWN_PATH)}`,
		{
			method: 'PUT',
			headers: {
				...authHeaders(token),
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				message,
				content: utf8ToBase64(content),
				sha
			})
		}
	);

	if (!response.ok) {
		const error = await response.json().catch(() => ({}));
		throw new Error(error.message ?? `GitHub API error ${response.status}`);
	}
}

export async function verifyGitHubToken(token: string): Promise<string> {
	const response = await fetch(`${API}/user`, { headers: authHeaders(token) });
	if (!response.ok) {
		throw new Error('Не удалось проверить токен GitHub');
	}
	const user = await response.json();
	return user.login as string;
}
