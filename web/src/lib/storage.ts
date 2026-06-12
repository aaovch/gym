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
	} catch (error) {
		console.error('Не удалось загрузить локальную базу тренировок:', error);
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
	} catch (error) {
		console.error('Не удалось загрузить локальный план циклов:', error);
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
	if (bTime !== aTime) return bTime > aTime ? b : a;
	if (b.revision !== a.revision) return b.revision > a.revision ? b : a;
	if (b.mesocycles.length !== a.mesocycles.length) {
		return b.mesocycles.length > a.mesocycles.length ? b : a;
	}
	return a;
}

/** Объединяет мезо/макро из всех копий плана — не теряет блоки при гонке с GitHub. */
export function mergeCyclePlans(...plans: Array<CyclePlan | null | undefined>): CyclePlan {
	const candidates = plans.filter((plan): plan is CyclePlan => plan != null);
	if (candidates.length === 0) return emptyCyclePlan();

	const base = candidates.reduce((winner, item) => pickNewerCyclePlan(winner, item));
	const mesoById = new Map(base.mesocycles.map((meso) => [meso.id, meso]));
	let changed = false;

	for (const plan of candidates) {
		for (const meso of plan.mesocycles) {
			if (!mesoById.has(meso.id)) {
				mesoById.set(meso.id, meso);
				changed = true;
			}
		}
	}

	const macroById = new Map(
		base.macrocycles.map((macro) => [macro.id, { ...macro, mesoIds: [...macro.mesoIds] }])
	);
	for (const plan of candidates) {
		for (const macro of plan.macrocycles) {
			const existing = macroById.get(macro.id);
			if (existing) {
				for (const mesoId of macro.mesoIds) {
					if (!existing.mesoIds.includes(mesoId) && mesoById.has(mesoId)) {
						existing.mesoIds.push(mesoId);
						changed = true;
					}
				}
			} else {
				const mesoIds = macro.mesoIds.filter((id) => mesoById.has(id));
				if (mesoIds.length) {
					macroById.set(macro.id, { ...macro, mesoIds });
					changed = true;
				}
			}
		}
	}

	const templateById = new Map(base.templates.map((template) => [template.id, template]));
	for (const plan of candidates) {
		for (const template of plan.templates) {
			if (!templateById.has(template.id)) {
				templateById.set(template.id, template);
				changed = true;
			}
		}
	}

	const merged = normalizeCyclePlan({
		...base,
		templates: [...templateById.values()],
		mesocycles: [...mesoById.values()],
		macrocycles: [...macroById.values()]
	});

	if (!changed) return merged;
	return {
		...merged,
		revision: Math.max(...candidates.map((plan) => plan.revision)) + 1,
		updatedAt: new Date().toISOString()
	};
}

export function ensureCyclePlan(plan: CyclePlan | null): CyclePlan {
	return plan ?? emptyCyclePlan();
}

export function pickNewerDatabase(a: WorkoutDatabase, b: WorkoutDatabase | null): WorkoutDatabase {
	if (!b) return a;
	const aTime = Date.parse(a.updatedAt || '0');
	const bTime = Date.parse(b.updatedAt || '0');
	if (bTime === aTime && b.revision !== a.revision) return b.revision > a.revision ? b : a;
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
