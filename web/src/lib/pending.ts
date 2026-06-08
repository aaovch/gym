import { browser } from '$app/environment';
import { writable } from 'svelte/store';
import type { DraftEntry } from './markdown';
import { draftToWorkoutParts } from './markdown';
import type { WorkoutEntry } from './types';

const TOKEN_KEY = 'gym_github_token';
const PENDING_KEY = 'gym_pending_entries';

export type PendingEntry = {
	id: string;
	draft: DraftEntry;
	createdAt: string;
};

function readPending(): PendingEntry[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(PENDING_KEY);
		return raw ? (JSON.parse(raw) as PendingEntry[]) : [];
	} catch {
		return [];
	}
}

function writePending(items: PendingEntry[]) {
	if (!browser) return;
	localStorage.setItem(PENDING_KEY, JSON.stringify(items));
}

export function getGitHubToken(): string {
	if (!browser) return '';
	return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setGitHubToken(token: string) {
	if (!browser) return;
	if (token.trim()) localStorage.setItem(TOKEN_KEY, token.trim());
	else localStorage.removeItem(TOKEN_KEY);
}

export function pendingToWorkoutEntries(pending: PendingEntry[]): WorkoutEntry[] {
	return pending.flatMap((item) => draftToWorkoutParts(item.draft));
}

function createPendingStore() {
	const { subscribe, set } = writable<PendingEntry[]>(readPending());

	return {
		subscribe,
		refresh() {
			set(readPending());
		},
		add(draft: DraftEntry) {
			const item: PendingEntry = {
				id: crypto.randomUUID(),
				draft,
				createdAt: new Date().toISOString()
			};
			writePending([item, ...readPending()]);
			set(readPending());
			return item;
		},
		remove(id: string) {
			writePending(readPending().filter((item) => item.id !== id));
			set(readPending());
		},
		clear() {
			writePending([]);
			set([]);
		}
	};
}

export const pendingStore = createPendingStore();
