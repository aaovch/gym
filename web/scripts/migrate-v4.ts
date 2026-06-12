import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	compactCyclePlan,
	compactWorkoutDatabase,
	normalizeStoredCyclePlan,
	normalizeWorkoutDatabase,
	stringifyCompact,
	validateDatabasePlanLinks
} from '../src/lib/json-store';

const root = resolve(import.meta.dirname, '../..');
const workoutsPath = resolve(root, 'data/workouts.json');
const planPath = resolve(root, 'data/cycle-plan.json');
const staticDir = resolve(root, 'web/static/data');

const workoutsRaw = JSON.parse(readFileSync(workoutsPath, 'utf-8'));
const planRaw = JSON.parse(readFileSync(planPath, 'utf-8'));
const database = normalizeWorkoutDatabase(workoutsRaw);
const plan = normalizeStoredCyclePlan(planRaw);
validateDatabasePlanLinks(database, plan);

const migratedDatabase = {
	...database,
	version: 4 as const,
	revision: workoutsRaw.version === 4 ? database.revision : database.revision + 1
};
const workoutsText = stringifyCompact(compactWorkoutDatabase(migratedDatabase));
writeFileSync(workoutsPath, workoutsText);
writeFileSync(resolve(staticDir, 'workouts.json'), workoutsText);

if (plan) {
	const migratedPlan = {
		...plan,
		version: 4 as const,
		revision: planRaw.version === 4 ? plan.revision : plan.revision + 1
	};
	const planText = stringifyCompact(compactCyclePlan(migratedPlan));
	writeFileSync(planPath, planText);
	writeFileSync(resolve(staticDir, 'cycle-plan.json'), planText);
}

console.log(
	`migrated to v4: ${migratedDatabase.exercises.length} exercises, ` +
		`${migratedDatabase.logs.length} logs, revision ${migratedDatabase.revision}`
);
