import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { sessionsToEntries } from '../src/lib/database';
import { repairWorkoutLinks } from '../src/lib/data-repair';
import {
	compactCyclePlan,
	compactWorkoutDatabase,
	logsToSessions,
	normalizeStoredCyclePlan,
	normalizeWorkoutDatabase,
	stringifyCompact,
	validateDatabasePlanLinks
} from '../src/lib/json-store';

const root = resolve(import.meta.dirname, '../..');
const workoutsPath = resolve(root, 'data/workouts.json');
const planPath = resolve(root, 'data/cycle-plan.json');

const workoutsRaw = JSON.parse(readFileSync(workoutsPath, 'utf-8'));
const planRaw = JSON.parse(readFileSync(planPath, 'utf-8'));

const database = normalizeWorkoutDatabase(workoutsRaw);
const plan = normalizeStoredCyclePlan(planRaw);
const entries = sessionsToEntries(logsToSessions(database));

const result = repairWorkoutLinks(database, plan, entries, {
	importPlanIfEmpty: true,
	repairPlanDates: false
});

validateDatabasePlanLinks(result.database, result.plan);
const checkOnly = process.argv.includes('--check');
if (!checkOnly && (result.logsLinked || result.logsUnlinked)) {
	writeFileSync(workoutsPath, stringifyCompact(compactWorkoutDatabase(result.database)));
}

if (!checkOnly && result.plan && (result.planImported || result.planDatesRepaired)) {
	const planText = stringifyCompact(compactCyclePlan(result.plan));
	writeFileSync(planPath, planText);
}
if (!checkOnly) execFileSync('python', [resolve(root, 'scripts/sync_static_data.py')], { stdio: 'inherit' });

const linked = result.database.logs.filter((log) => log.microSessionId).length;
console.log(
	`${checkOnly ? 'check only, files unchanged' : 'repaired'}: logsLinked=${result.logsLinked}, ` +
		`microSessionId ${linked}/${result.database.logs.length}, planImported=${result.planImported}, ` +
		`anchorsRefreshed=${result.anchorsRefreshed}`
);
console.log(
	'exercises:',
	result.database.exercises.map((item) => `${item.id} ← ${item.name}`).join('\n  ')
);
