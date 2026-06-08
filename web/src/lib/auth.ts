import { browser } from '$app/environment';

const TOKEN_KEY = 'gym_github_token';

export function getGitHubToken(): string {
	if (!browser) return '';
	return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setGitHubToken(token: string) {
	if (!browser) return;
	if (token.trim()) localStorage.setItem(TOKEN_KEY, token.trim());
	else localStorage.removeItem(TOKEN_KEY);
}

export function hasGitHubToken(): boolean {
	return getGitHubToken().length > 0;
}
