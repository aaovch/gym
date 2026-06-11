import { browser } from '$app/environment';
import type { CyclePlan } from './cycle-plan';
import { emptyCyclePlan } from './cycle-plan';
import type { WorkoutDatabase } from './types';

const DB_KEY = 'gym_workout_db';
const CYCLE_PLAN_KEY = 'gym_cycle_plan';

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

export function loadCyclePlan(): CyclePlan | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(CYCLE_PLAN_KEY);
		if (!raw) return null;
		return JSON.parse(raw) as CyclePlan;
	} catch {
		return null;
	}
}

export function saveCyclePlan(plan: CyclePlan) {
	if (!browser) return;
	localStorage.setItem(CYCLE_PLAN_KEY, JSON.stringify(plan));
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
