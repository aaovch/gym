import { browser } from '$app/environment';
import type { CyclePlan } from './cycle-plan';
import { emptyCyclePlan, normalizeCyclePlan } from './cycle-plan';
import {
	compactCyclePlan,
	compactWorkoutDatabase,
	normalizeStoredCyclePlan,
	normalizeWorkoutDatabase,
	stringifyCompact
} from './json-store';
import type { WorkoutDatabase } from './types';

const DB_KEY = 'gym_workout_db';
const CYCLE_PLAN_KEY = 'gym_cycle_plan';

export function loadLocalDatabase(): WorkoutDatabase | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(DB_KEY);
		if (!raw) return null;
		return normalizeWorkoutDatabase(JSON.parse(raw));
	} catch {
		return null;
	}
}

export function saveLocalDatabase(db: WorkoutDatabase) {
	if (!browser) return;
	localStorage.setItem(DB_KEY, stringifyCompact(compactWorkoutDatabase(db)));
}

export function clearLocalDatabase() {
	if (!browser) return;
	localStorage.removeItem(DB_KEY);
}

export function loadCyclePlan(): CyclePlan | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(CYCLE_PLAN_KEY);
		if (!raw) return null;
		const plan = normalizeStoredCyclePlan(JSON.parse(raw));
		if (!plan) return null;
		return normalizeCyclePlan(plan);
	} catch {
		return null;
	}
}

export function saveCyclePlan(plan: CyclePlan) {
	if (!browser) return;
	const normalized = normalizeCyclePlan(plan);
	localStorage.setItem(CYCLE_PLAN_KEY, stringifyCompact(compactCyclePlan(normalized)));
}

export function clearCyclePlan() {
	if (!browser) return;
	localStorage.removeItem(CYCLE_PLAN_KEY);
}

export function pickNewerCyclePlan(a: CyclePlan, b: CyclePlan | null): CyclePlan {
	if (!b) return a;
	const aTime = Date.parse(a.updatedAt || '0');
	const bTime = Date.parse(b.updatedAt || '0');
	return bTime > aTime ? b : a;
}

export function ensureCyclePlan(plan: CyclePlan | null): CyclePlan {
	return plan ?? emptyCyclePlan();
}

export function pickNewerDatabase(a: WorkoutDatabase, b: WorkoutDatabase | null): WorkoutDatabase {
	if (!b) return a;
	const aTime = Date.parse(a.updatedAt || '0');
	const bTime = Date.parse(b.updatedAt || '0');
	return bTime > aTime ? b : a;
}

/** Сериализация для GitHub / файлов. */
export function serializeWorkoutDatabase(db: WorkoutDatabase): string {
	return stringifyCompact(compactWorkoutDatabase(db));
}

export function parseWorkoutDatabase(raw: string): WorkoutDatabase {
	return normalizeWorkoutDatabase(JSON.parse(raw));
}

export function serializeCyclePlan(plan: CyclePlan): string {
	return stringifyCompact(compactCyclePlan(normalizeCyclePlan(plan)));
}

export function parseCyclePlan(raw: string): CyclePlan | null {
	const plan = normalizeStoredCyclePlan(JSON.parse(raw));
	return plan ? normalizeCyclePlan(plan) : null;
}
