import type { CyclePlan, MesocyclePlan } from './cycle-plan';
import { normalizeMicrocycles } from './micro-plan';
import {
	bundledProtocolById,
	isBundledProtocolId,
	isCustomProtocolId,
	type ProtocolTemplate
} from './protocol';
import type { Exercise, ExerciseLog, SetBlock, WorkoutDatabase, WorkoutSession } from './types';

/** Компактный формат на диске / в GitHub. */
export type StoredWorkoutDatabase = {
	version: 3;
	updatedAt: string;
	exercises: StoredExercise[];
	logs: StoredExerciseLog[];
};

type StoredExercise = {
	id: string;
	n: string;
	k?: Exercise['kind'];
	b?: Exercise['movementBlocks'];
};

type StoredExerciseLog = {
	id: string;
	e: string;
	d: string;
	ms?: string;
	rows: StoredSetBlock[];
};

type StoredSetBlock = {
	s: [number, number][];
	c?: string;
};

/** Компактный план циклов: только изменённые шаблоны и ручные якоря. */
export type StoredCyclePlan = {
	version: 3;
	updatedAt: string;
	templates: ProtocolTemplate[];
	macrocycles: CyclePlan['macrocycles'];
	mesocycles: StoredMesocyclePlan[];
};

type StoredMesocyclePlan = Omit<MesocyclePlan, 'anchor1rm' | 'anchor1rmManual'> & {
	anchor1rm?: Record<string, number>;
	anchor1rmManual?: Record<string, boolean>;
};

function roundNum(n: number): number {
	return Number.isInteger(n) ? n : Math.round(n * 10) / 10;
}

function compactBlock(row: SetBlock): StoredSetBlock {
	const stored: StoredSetBlock = {
		s: row.sets.map(([w, r]) => [roundNum(w), roundNum(r)] as [number, number])
	};
	const comment = row.comment?.trim();
	if (comment) stored.c = comment;
	return stored;
}

function expandBlock(row: StoredSetBlock): SetBlock {
	return {
		sets: row.s.map(([w, r]) => [w, r] as [number, number]),
		comment: row.c ?? null
	};
}

function compactExercise(exercise: Exercise): StoredExercise {
	const stored: StoredExercise = { id: exercise.id, n: exercise.name };
	if (exercise.kind !== 'strength') stored.k = exercise.kind;
	if (exercise.movementBlocks.length > 0) stored.b = exercise.movementBlocks;
	return stored;
}

function expandExercise(stored: StoredExercise): Exercise {
	return {
		id: stored.id,
		name: stored.n,
		kind: stored.k ?? 'strength',
		movementBlocks: stored.b ?? []
	};
}

export function emptyWorkoutDatabase(): WorkoutDatabase {
	return { version: 3, updatedAt: '', exercises: [], logs: [] };
}

export function logsToSessions(db: WorkoutDatabase): WorkoutSession[] {
	const byId = new Map(db.exercises.map((item) => [item.id, item]));
	const sessions: WorkoutSession[] = [];
	for (const log of db.logs) {
		const exercise = byId.get(log.exerciseId);
		const rows = log.blocks.filter((block) => block.sets.length > 0);
		if (rows.length === 0) continue;
		sessions.push({
			id: log.id,
			exerciseId: log.exerciseId,
			exercise: exercise?.name ?? log.exerciseId,
			date: log.date,
			rows,
			microSessionId: log.microSessionId
		});
	}
	return sessions;
}

export function normalizeWorkoutDatabase(raw: unknown): WorkoutDatabase {
	if (!raw || typeof raw !== 'object') return emptyWorkoutDatabase();
	const obj = raw as Record<string, unknown>;

	if (obj.version === 3 && Array.isArray(obj.exercises) && Array.isArray(obj.logs)) {
		return expandStoredWorkoutV3(obj as StoredWorkoutDatabase);
	}

	return emptyWorkoutDatabase();
}

function expandStoredWorkoutV3(stored: StoredWorkoutDatabase): WorkoutDatabase {
	const exercises = stored.exercises.map(expandExercise);
	const logs: ExerciseLog[] = [];
	for (const log of stored.logs) {
		const blocks = log.rows.map(expandBlock).filter((block) => block.sets.length > 0);
		if (blocks.length === 0) continue;
		logs.push({
			id: log.id,
			exerciseId: log.e,
			date: log.d,
			blocks,
			microSessionId: log.ms
		});
	}

	return { version: 3, updatedAt: stored.updatedAt, exercises, logs };
}

export function compactWorkoutDatabase(db: WorkoutDatabase): StoredWorkoutDatabase {
	const exercises = db.exercises.map(compactExercise);
	const logs: StoredExerciseLog[] = [];

	for (const log of db.logs) {
		const rows = log.blocks.map(compactBlock).filter((row) => row.s.length > 0);
		if (rows.length === 0) continue;
		const stored: StoredExerciseLog = {
			id: log.id,
			e: log.exerciseId,
			d: log.date,
			rows
		};
		if (log.microSessionId) stored.ms = log.microSessionId;
		logs.push(stored);
	}

	return {
		version: 3,
		updatedAt: db.updatedAt,
		exercises,
		logs
	};
}

function templateEqualsBundled(template: ProtocolTemplate): boolean {
	if (!isBundledProtocolId(template.id)) return false;
	const bundled = bundledProtocolById(template.id);
	if (!bundled) return false;
	return JSON.stringify(template) === JSON.stringify(bundled);
}

function compactMesocycle(meso: MesocyclePlan): StoredMesocyclePlan {
	const manual = meso.anchor1rmManual ?? {};
	const anchor1rm: Record<string, number> = {};
	for (const [exerciseId, isManual] of Object.entries(manual)) {
		if (isManual && meso.anchor1rm[exerciseId] != null) {
			anchor1rm[exerciseId] = meso.anchor1rm[exerciseId];
		}
	}

	const stored: StoredMesocyclePlan = {
		id: meso.id,
		label: meso.label,
		startDate: meso.startDate,
		endDate: meso.endDate,
		microcycles: meso.microcycles,
		templateId: meso.templateId
	};

	if (meso.macroId) stored.macroId = meso.macroId;
	if (Object.keys(anchor1rm).length > 0) {
		stored.anchor1rm = anchor1rm;
		stored.anchor1rmManual = Object.fromEntries(Object.keys(anchor1rm).map((key) => [key, true]));
	}
	if (meso.exerciseProtocols && Object.keys(meso.exerciseProtocols).length > 0) {
		stored.exerciseProtocols = meso.exerciseProtocols;
	}

	return stored;
}

export function compactCyclePlan(plan: CyclePlan): StoredCyclePlan {
	const templates = plan.templates.filter(
		(template) => isCustomProtocolId(template.id) || !templateEqualsBundled(template)
	);

	return {
		version: 3,
		updatedAt: plan.updatedAt,
		templates,
		macrocycles: plan.macrocycles,
		mesocycles: plan.mesocycles.map(compactMesocycle)
	};
}

export function normalizeStoredCyclePlan(raw: unknown): CyclePlan | null {
	if (!raw || typeof raw !== 'object') return null;
	const obj = raw as Record<string, unknown>;
	if (obj.version !== 3) return null;

	const templates = Array.isArray(obj.templates) ? (obj.templates as ProtocolTemplate[]) : [];
	const macrocycles = Array.isArray(obj.macrocycles) ? (obj.macrocycles as CyclePlan['macrocycles']) : [];
	const mesocyclesRaw = Array.isArray(obj.mesocycles) ? (obj.mesocycles as StoredMesocyclePlan[]) : [];

	const mesocycles: MesocyclePlan[] = mesocyclesRaw.map((meso) => ({
		id: meso.id,
		label: meso.label,
		startDate: meso.startDate,
		endDate: meso.endDate,
		microcycles: normalizeMicrocycles(meso.microcycles),
		templateId: meso.templateId,
		macroId: meso.macroId,
		anchor1rm: meso.anchor1rm ?? {},
		anchor1rmManual: meso.anchor1rmManual ?? {},
		exerciseProtocols: meso.exerciseProtocols
	}));

	return {
		version: 3,
		updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : '',
		templates,
		macrocycles,
		mesocycles
	};
}

/** Minified JSON без null/undefined. */
export function stringifyCompact(value: unknown): string {
	return JSON.stringify(value);
}

export function parseJson<T = unknown>(raw: string): T {
	return JSON.parse(raw) as T;
}
