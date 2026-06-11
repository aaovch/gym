import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sessionsToEntries } from '../src/lib/database';
import { repairWorkoutLinks } from '../src/lib/data-repair';
import {
	compactCyclePlan,
	compactWorkoutDatabase,
	logsToSessions,
	normalizeStoredCyclePlan,
	normalizeWorkoutDatabase,
	stringifyCompact
} from '../src/lib/json-store';

const root = resolve(import.meta.dirname, '../..');
const workoutsPath = resolve(root, 'data/workouts.json');
const planPath = resolve(root, 'data/cycle-plan.json');
const staticDir = resolve(root, 'web/static/data');

const workoutsRaw = JSON.parse(readFileSync(workoutsPath, 'utf-8'));
const planRaw = JSON.parse(readFileSync(planPath, 'utf-8'));

const database = normalizeWorkoutDatabase(workoutsRaw);
const plan = normalizeStoredCyclePlan(planRaw);
const entries = sessionsToEntries(logsToSessions(database));

const result = repairWorkoutLinks(database, plan, entries, {
	importPlanIfEmpty: true,
	repairPlanDates: true
});

const workoutsText = stringifyCompact(compactWorkoutDatabase(result.database));
writeFileSync(workoutsPath, workoutsText);
writeFileSync(resolve(staticDir, 'workouts.json'), workoutsText);

if (result.plan) {
	const planText = stringifyCompact(compactCyclePlan(result.plan));
	writeFileSync(planPath, planText);
	writeFileSync(resolve(staticDir, 'cycle-plan.json'), planText);
}

const linked = result.database.logs.filter((log) => log.microSessionId).length;
console.log(
	`repaired: logsLinked=${result.logsLinked}, ` +
		`microSessionId ${linked}/${result.database.logs.length}, planImported=${result.planImported}, ` +
		`anchorsRefreshed=${result.anchorsRefreshed}`
);
console.log(
	'exercises:',
	result.database.exercises.map((item) => `${item.id} ← ${item.name}`).join('\n  ')
);
