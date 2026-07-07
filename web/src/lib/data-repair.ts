import type { CyclePlan } from './cycle-plan';
import { importPlanFromAuto, refreshAllMesoAnchors, repairMicroDatesFromAuto } from './cycle-plan';
import { buildWorkoutKeyMaps } from './exercise-keys';
import { buildMicrocycleOverview, type MicrocycleOverview } from './microcycle';
import { logsToSessions } from './json-store';
import type { ExerciseLog, WorkoutDatabase, WorkoutEntry } from './types';

export type WorkoutLinkRepairResult = {
	database: WorkoutDatabase;
	plan: CyclePlan | null;
	logsLinked: number;
	logsUnlinked: number;
	planImported: boolean;
	planDatesRepaired: boolean;
	anchorsRefreshed: boolean;
};

function microSessionLookup(plan: CyclePlan | null): {
	byDate: Map<string, string>;
	byDateSlot: Map<string, string>;
	sessionIds: Set<string>;
} {
	const byDate = new Map<string, string>();
	const byDateSlot = new Map<string, string>();
	const sessionIds = new Set<string>();
	if (!plan) return { byDate, byDateSlot, sessionIds };

	for (const meso of plan.mesocycles) {
		for (const micro of meso.microcycles) {
			for (const session of micro.sessions) {
				sessionIds.add(session.id);
				if (!session.date) continue;
				byDate.set(session.date, session.id);
				byDateSlot.set(`${session.date}:${session.indexInMicro}`, session.id);
			}
		}
	}

	return { byDate, byDateSlot, sessionIds };
}

export function repairLogMicroSessionIds(
	db: WorkoutDatabase,
	plan: CyclePlan | null,
	overview: MicrocycleOverview
): { database: WorkoutDatabase; linked: number; unlinked: number } {
	const lookup = microSessionLookup(plan);
	let linked = 0;
	let unlinked = 0;

	const logs = db.logs.map((log) => {
		if (log.microSessionId && lookup.sessionIds.size === 0) return log;

		const day = overview.byDate.get(log.date);
		const msId =
			lookup.byDate.get(log.date) ??
			(day && day.indexInMicro >= 0
				? lookup.byDateSlot.get(`${log.date}:${day.indexInMicro}`)
				: undefined);
		if (!msId) {
			if (log.microSessionId && !lookup.sessionIds.has(log.microSessionId)) {
				const { microSessionId: _microSessionId, ...cleanLog } = log;
				unlinked += 1;
				return cleanLog;
			}
			return log;
		}
		if (log.microSessionId === msId) return log;

		linked += 1;
		return { ...log, microSessionId: msId };
	});

	return { database: { ...db, logs }, linked, unlinked };
}

export function countLogsWithoutMicroSession(db: WorkoutDatabase): number {
	return db.logs.filter((log) => !log.microSessionId).length;
}

/** Привязать логи к MicroSessionPlan, при необходимости импортировать/починить план. */
export function repairWorkoutLinks(
	database: WorkoutDatabase,
	plan: CyclePlan | null,
	entries: WorkoutEntry[],
	options: {
		importPlanIfEmpty?: boolean;
		repairPlanDates?: boolean;
	} = {}
): WorkoutLinkRepairResult {
	const importPlanIfEmpty = options.importPlanIfEmpty ?? true;
	const repairPlanDates = options.repairPlanDates ?? true;

	let nextPlan = plan;
	let planImported = false;
	let planDatesRepaired = false;

	const sessions = logsToSessions(database);
	let overview = buildMicrocycleOverview(sessions);

	if (importPlanIfEmpty && (!nextPlan || nextPlan.mesocycles.length === 0)) {
		nextPlan = importPlanFromAuto(overview, entries, nextPlan);
		planImported = true;
	}

	if (repairPlanDates && nextPlan && nextPlan.mesocycles.length > 0) {
		const repairedPlan = repairMicroDatesFromAuto(nextPlan, overview);
		planDatesRepaired = repairedPlan !== nextPlan;
		nextPlan = repairedPlan;
	}

	const {
		database: linkedDb,
		linked: logsLinked,
		unlinked: logsUnlinked
	} = repairLogMicroSessionIds(database, nextPlan, overview);

	let anchorsRefreshed = false;
	if (nextPlan) {
		const keyMaps = buildWorkoutKeyMaps(linkedDb.exercises, entries);
		const refreshed = refreshAllMesoAnchors(nextPlan, entries, true, keyMaps);
		anchorsRefreshed = JSON.stringify(refreshed) !== JSON.stringify(plan);
		nextPlan = refreshed;
	}

	return {
		database: linkedDb,
		plan: nextPlan,
		logsLinked,
		logsUnlinked,
		planImported,
		planDatesRepaired,
		anchorsRefreshed
	};
}

export function summarizeLogMicroLinks(logs: ExerciseLog[]): { total: number; linked: number } {
	const total = logs.length;
	const linked = logs.filter((log) => Boolean(log.microSessionId)).length;
	return { total, linked };
}
