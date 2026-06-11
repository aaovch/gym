import { browser } from '$app/environment';
import type { WorkoutDatabase } from './types';

const DB_KEY = 'gym_workout_db';

export function loadLocalDatabase(): WorkoutDatabase | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(DB_KEY);
		if (!raw) return null;
		return JSON.parse(raw) as WorkoutDatabase;
	} catch {
		return null;
	}
}

export function saveLocalDatabase(db: WorkoutDatabase) {
	if (!browser) return;
	localStorage.setItem(DB_KEY, JSON.stringify(db));
}

export function clearLocalDatabase() {
	if (!browser) return;
	localStorage.removeItem(DB_KEY);
}

export function pickNewerDatabase(a: WorkoutDatabase, b: WorkoutDatabase | null): WorkoutDatabase {
	if (!b) return a;
	const aTime = Date.parse(a.updatedAt || '0');
	const bTime = Date.parse(b.updatedAt || '0');
	return bTime > aTime ? b : a;
}
