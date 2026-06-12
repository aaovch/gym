import type { CyclePlan, MacrocyclePlan, MesocyclePlan } from './cycle-plan';
import { exerciseKindFromName, ensureExerciseCatalog } from './exercises';
import { microDates, normalizeMicrocycles, type MicrocyclePlan } from './micro-plan';
import {
	bundledProtocolById,
	isBundledProtocolId,
	isCustomProtocolId,
	type ProtocolTemplate
} from './protocol';
import type {
	Exercise,
	ExerciseKind,
	ExerciseLog,
	ExerciseSet,
	SetBlock,
	WorkoutDatabase,
	WorkoutSession
} from './types';

export class SchemaValidationError extends Error {
	constructor(
		public readonly document: string,
		public readonly issues: string[]
	) {
		super(`${document}: ${issues.join('; ')}`);
		this.name = 'SchemaValidationError';
	}
}

type JsonObject = Record<string, unknown>;

export type StoredWorkoutDatabase = {
	version: 4;
	revision: number;
	updatedAt: string;
	exercises: StoredExercise[];
	logs: StoredExerciseLog[];
};

type StoredExercise = {
	id: string;
	n: string;
	k: ExerciseKind;
	b?: Exercise['movementBlocks'];
};

type StoredStrengthSet = { weightKg: number; reps: number };
type StoredRunSet = { durationMin: number; speedKmh: number };
type StoredJumpSet = { setCount: number; repsPerSet: number };

type StoredSetBlock =
	| { kind: 'strength'; sets: StoredStrengthSet[]; comment?: string }
	| { kind: 'run'; sets: StoredRunSet[]; comment?: string }
	| { kind: 'jumps'; sets: StoredJumpSet[]; comment?: string };

type StoredExerciseLog = {
	id: string;
	exerciseId: string;
	date: string;
	microSessionId?: string;
	blocks: StoredSetBlock[];
};

type StoredMacrocyclePlan = Omit<MacrocyclePlan, 'startDate' | 'endDate'>;

type StoredMesocyclePlan = Omit<
	MesocyclePlan,
	'startDate' | 'endDate' | 'anchor1rm' | 'anchor1rmManual'
> & {
	plannedStartDate?: string;
	plannedEndDate?: string;
	anchor1rm?: Record<string, number>;
	anchor1rmManual?: Record<string, boolean>;
};

export type StoredCyclePlan = {
	version: 4;
	revision: number;
	updatedAt: string;
	templates: ProtocolTemplate[];
	macrocycles: StoredMacrocyclePlan[];
	mesocycles: StoredMesocyclePlan[];
};

function isObject(value: unknown): value is JsonObject {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isPositiveNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isIsoDateTime(value: unknown): value is string {
	return typeof value === 'string' && (value === '' || Number.isFinite(Date.parse(value)));
}

function isExerciseKind(value: unknown): value is ExerciseKind {
	return value === 'strength' || value === 'run' || value === 'jumps';
}

function text(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function roundNum(n: number): number {
	return Number.isInteger(n) ? n : Math.round(n * 10) / 10;
}

function compactBlock(row: SetBlock): StoredSetBlock {
	const comment = row.comment?.trim() || undefined;
	if (row.kind === 'run') {
		return {
			kind: 'run',
			sets: row.sets.map(([durationMin, speedKmh]) => ({
				durationMin: roundNum(durationMin),
				speedKmh: roundNum(speedKmh)
			})),
			...(comment ? { comment } : {})
		};
	}
	if (row.kind === 'jumps') {
		return {
			kind: 'jumps',
			sets: row.sets.map(([setCount, repsPerSet]) => ({
				setCount: roundNum(setCount),
				repsPerSet: roundNum(repsPerSet)
			})),
			...(comment ? { comment } : {})
		};
	}
	return {
		kind: 'strength',
		sets: row.sets.map(([weightKg, reps]) => ({
			weightKg: roundNum(weightKg),
			reps: roundNum(reps)
		})),
		...(comment ? { comment } : {})
	};
}

function expandBlock(row: StoredSetBlock): SetBlock {
	let sets: ExerciseSet[];
	if (row.kind === 'run') {
		sets = row.sets.map(({ durationMin, speedKmh }) => [durationMin, speedKmh]);
	} else if (row.kind === 'jumps') {
		sets = row.sets.map(({ setCount, repsPerSet }) => [setCount, repsPerSet]);
	} else {
		sets = row.sets.map(({ weightKg, reps }) => [weightKg, reps]);
	}
	return { kind: row.kind, sets, comment: row.comment ?? null };
}

function compactExercise(exercise: Exercise): StoredExercise {
	const stored: StoredExercise = {
		id: exercise.id,
		n: exercise.name,
		k: exercise.kind
	};
	if (exercise.movementBlocks.length > 0) stored.b = exercise.movementBlocks;
	return stored;
}

function expandExercise(stored: StoredExercise): Exercise {
	return {
		id: stored.id,
		name: stored.n,
		kind: stored.k,
		movementBlocks: stored.b ?? []
	};
}

export function emptyWorkoutDatabase(): WorkoutDatabase {
	return { version: 4, revision: 0, updatedAt: '', exercises: [], logs: [] };
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

function validateStoredWorkoutV4(raw: unknown): StoredWorkoutDatabase {
	const issues: string[] = [];
	if (!isObject(raw)) throw new SchemaValidationError('workouts.json', ['корень должен быть объектом']);
	const exercisesRaw = Array.isArray(raw.exercises) ? raw.exercises : [];
	const logsRaw = Array.isArray(raw.logs) ? raw.logs : [];
	if (!Array.isArray(raw.exercises)) issues.push('exercises должен быть массивом');
	if (!Array.isArray(raw.logs)) issues.push('logs должен быть массивом');
	if (!Number.isInteger(raw.revision) || Number(raw.revision) < 0) issues.push('revision должен быть целым >= 0');
	if (!isIsoDateTime(raw.updatedAt)) issues.push('updatedAt должен быть ISO-временем');

	const exerciseIds = new Set<string>();
	const exerciseKinds = new Map<string, ExerciseKind>();
	for (const [index, value] of exercisesRaw.entries()) {
		if (!isObject(value)) {
			issues.push(`exercises[${index}] должен быть объектом`);
			continue;
		}
		if (typeof value.id !== 'string' || !value.id) issues.push(`exercises[${index}].id обязателен`);
		else if (exerciseIds.has(value.id)) issues.push(`дубликат Exercise.id: ${value.id}`);
		else exerciseIds.add(value.id);
		if (typeof value.n !== 'string' || !value.n.trim()) issues.push(`exercises[${index}].n обязателен`);
		if (!isExerciseKind(value.k)) issues.push(`exercises[${index}].k имеет неизвестный тип`);
		else if (typeof value.id === 'string') exerciseKinds.set(value.id, value.k);
		if (value.b != null && !Array.isArray(value.b)) issues.push(`exercises[${index}].b должен быть массивом`);
	}

	const logIds = new Set<string>();
	for (const [index, value] of logsRaw.entries()) {
		if (!isObject(value)) {
			issues.push(`logs[${index}] должен быть объектом`);
			continue;
		}
		if (typeof value.id !== 'string' || !value.id) issues.push(`logs[${index}].id обязателен`);
		else if (logIds.has(value.id)) issues.push(`дубликат ExerciseLog.id: ${value.id}`);
		else logIds.add(value.id);
		if (typeof value.exerciseId !== 'string' || !exerciseIds.has(value.exerciseId)) {
			issues.push(`logs[${index}].exerciseId ссылается на отсутствующее упражнение`);
		}
		const exerciseKind =
			typeof value.exerciseId === 'string' ? exerciseKinds.get(value.exerciseId) : undefined;
		if (!isIsoDate(value.date)) issues.push(`logs[${index}].date должен быть YYYY-MM-DD`);
		if (!Array.isArray(value.blocks) || value.blocks.length === 0) {
			issues.push(`logs[${index}].blocks должен содержать хотя бы один блок`);
			continue;
		}
		for (const [blockIndex, block] of value.blocks.entries()) {
			if (!isObject(block) || !isExerciseKind(block.kind) || !Array.isArray(block.sets)) {
				issues.push(`logs[${index}].blocks[${blockIndex}] имеет неверную структуру`);
				continue;
			}
			if (exerciseKind && block.kind !== exerciseKind) {
				issues.push(`logs[${index}].blocks[${blockIndex}].kind не совпадает с Exercise.kind`);
			}
			if (block.sets.length === 0) issues.push(`logs[${index}].blocks[${blockIndex}].sets пуст`);
			for (const [setIndex, set] of block.sets.entries()) {
				if (!isObject(set)) {
					issues.push(`logs[${index}].blocks[${blockIndex}].sets[${setIndex}] должен быть объектом`);
					continue;
				}
				const values =
					block.kind === 'strength'
						? [set.weightKg, set.reps]
						: block.kind === 'run'
							? [set.durationMin, set.speedKmh]
							: [set.setCount, set.repsPerSet];
				if (!values.every(isPositiveNumber)) {
					issues.push(`logs[${index}].blocks[${blockIndex}].sets[${setIndex}] содержит невалидные числа`);
				}
			}
		}
	}

	if (issues.length) throw new SchemaValidationError('workouts.json', issues);
	return raw as StoredWorkoutDatabase;
}

function migrateLegacySessions(raw: JsonObject): StoredWorkoutDatabase {
	const sessions = Array.isArray(raw.sessions) ? raw.sessions : [];
	const names = sessions
		.filter(isObject)
		.map((session) => text(session.exercise).trim())
		.filter(Boolean);
	const catalog = ensureExerciseCatalog(names);
	const byName = new Map(catalog.map((exercise) => [exercise.name, exercise]));
	const logs: StoredExerciseLog[] = [];

	for (const [index, value] of sessions.entries()) {
		if (!isObject(value)) continue;
		const exercise = byName.get(text(value.exercise));
		if (!exercise || !isIsoDate(value.date) || !Array.isArray(value.rows)) continue;
		const blocks: StoredSetBlock[] = [];
		for (const row of value.rows) {
			if (!isObject(row) || !Array.isArray(row.sets)) continue;
			const pairs = row.sets.filter(
				(set): set is [number, number] =>
					Array.isArray(set) && set.length === 2 && isPositiveNumber(set[0]) && isPositiveNumber(set[1])
			);
			if (!pairs.length) continue;
			blocks.push(
				compactBlock({
					kind: exercise.kind,
					sets: pairs,
					comment: typeof row.comment === 'string' ? row.comment : null
				})
			);
		}
		if (!blocks.length) continue;
		logs.push({
			id: text(value.id, `legacy-log-${index + 1}`),
			exerciseId: exercise.id,
			date: value.date,
			blocks
		});
	}

	return {
		version: 4,
		revision: 0,
		updatedAt: text(raw.updatedAt),
		exercises: catalog.map(compactExercise),
		logs
	};
}

function migrateWorkoutV3(raw: JsonObject): StoredWorkoutDatabase {
	const exercisesRaw = Array.isArray(raw.exercises) ? raw.exercises : [];
	const exercises: StoredExercise[] = exercisesRaw.filter(isObject).map((item) => {
		const name = text(item.n);
		return {
			id: text(item.id),
			n: name,
			k: isExerciseKind(item.k) ? item.k : exerciseKindFromName(name),
			...(Array.isArray(item.b) ? { b: item.b as Exercise['movementBlocks'] } : {})
		};
	});
	const kindById = new Map(exercises.map((exercise) => [exercise.id, exercise.k]));
	const logsRaw = Array.isArray(raw.logs) ? raw.logs : [];
	const logs: StoredExerciseLog[] = logsRaw.filter(isObject).map((log, index) => {
		const exerciseId = text(log.e);
		const kind = kindById.get(exerciseId) ?? 'strength';
		const rows = Array.isArray(log.rows) ? log.rows : [];
		const blocks = rows.filter(isObject).flatMap((row) => {
			const sets = Array.isArray(row.s)
				? row.s.filter(
						(set): set is [number, number] =>
							Array.isArray(set) &&
							set.length === 2 &&
							isPositiveNumber(set[0]) &&
							isPositiveNumber(set[1])
					)
				: [];
			if (!sets.length) return [];
			return [
				compactBlock({
					kind,
					sets,
					comment: typeof row.c === 'string' ? row.c : null
				})
			];
		});
		return {
			id: text(log.id, `v3-log-${index + 1}`),
			exerciseId,
			date: text(log.d),
			...(typeof log.ms === 'string' ? { microSessionId: log.ms } : {}),
			blocks
		};
	});
	return {
		version: 4,
		revision: 0,
		updatedAt: text(raw.updatedAt),
		exercises,
		logs
	};
}

export function normalizeWorkoutDatabase(raw: unknown): WorkoutDatabase {
	if (!isObject(raw)) throw new SchemaValidationError('workouts.json', ['корень должен быть объектом']);
	let migrated: StoredWorkoutDatabase;
	if (raw.version === 4) migrated = validateStoredWorkoutV4(raw);
	else if (raw.version === 3) migrated = validateStoredWorkoutV4(migrateWorkoutV3(raw));
	else if ((raw.version === 1 || raw.version === 2) && Array.isArray(raw.sessions)) {
		migrated = validateStoredWorkoutV4(migrateLegacySessions(raw));
	} else {
		throw new SchemaValidationError('workouts.json', [`неподдерживаемая версия: ${String(raw.version)}`]);
	}

	return {
		version: 4,
		revision: migrated.revision,
		updatedAt: migrated.updatedAt,
		exercises: migrated.exercises.map(expandExercise),
		logs: migrated.logs.map((log) => ({
			id: log.id,
			exerciseId: log.exerciseId,
			date: log.date,
			blocks: log.blocks.map(expandBlock),
			microSessionId: log.microSessionId
		}))
	};
}

export function compactWorkoutDatabase(db: WorkoutDatabase): StoredWorkoutDatabase {
	const stored: StoredWorkoutDatabase = {
		version: 4,
		revision: db.revision,
		updatedAt: db.updatedAt,
		exercises: db.exercises.map(compactExercise),
		logs: db.logs.map((log) => ({
			id: log.id,
			exerciseId: log.exerciseId,
			date: log.date,
			...(log.microSessionId ? { microSessionId: log.microSessionId } : {}),
			blocks: log.blocks.filter((block) => block.sets.length > 0).map(compactBlock)
		}))
	};
	return validateStoredWorkoutV4(stored);
}

function templateEqualsBundled(template: ProtocolTemplate): boolean {
	if (!isBundledProtocolId(template.id)) return false;
	const bundled = bundledProtocolById(template.id);
	return Boolean(bundled) && JSON.stringify(template) === JSON.stringify(bundled);
}

function mesoDateRange(microcycles: MicrocyclePlan[], fallbackStart = '', fallbackEnd = '') {
	const dates = microcycles.flatMap(microDates).sort();
	return {
		startDate: dates[0] ?? fallbackStart,
		endDate: dates[dates.length - 1] ?? fallbackEnd
	};
}

function compactMesocycle(meso: MesocyclePlan): StoredMesocyclePlan {
	const manual = meso.anchor1rmManual ?? {};
	const anchor1rm: Record<string, number> = {};
	const hasDates = meso.microcycles.some((micro) => microDates(micro).length > 0);

	if (!hasDates) {
		for (const [exerciseId, value] of Object.entries(meso.anchor1rm)) {
			if (value != null && value > 0) anchor1rm[exerciseId] = value;
		}
	} else {
		for (const [exerciseId, isManual] of Object.entries(manual)) {
			if (isManual && meso.anchor1rm[exerciseId] != null) {
				anchor1rm[exerciseId] = meso.anchor1rm[exerciseId];
			}
		}
	}

	for (const exerciseId of new Set([
		...Object.keys(meso.exerciseProtocols ?? {}),
		...Object.keys(meso.exerciseSessions ?? {})
	])) {
		const value = meso.anchor1rm[exerciseId];
		if (value != null && value > 0) anchor1rm[exerciseId] = value;
	}
	const stored: StoredMesocyclePlan = {
		id: meso.id,
		label: meso.label,
		microcycles: meso.microcycles,
		templateId: meso.templateId
	};
	if (!hasDates && meso.startDate) stored.plannedStartDate = meso.startDate;
	if (!hasDates && meso.endDate) stored.plannedEndDate = meso.endDate;
	if (Object.keys(anchor1rm).length) {
		stored.anchor1rm = anchor1rm;
		const manualFlags = Object.fromEntries(
			Object.keys(anchor1rm)
				.filter((key) => manual[key])
				.map((key) => [key, true])
		);
		if (Object.keys(manualFlags).length) stored.anchor1rmManual = manualFlags;
	}
	if (meso.exerciseProtocols && Object.keys(meso.exerciseProtocols).length) {
		stored.exerciseProtocols = meso.exerciseProtocols;
	}
	if (meso.exerciseSessions && Object.keys(meso.exerciseSessions).length) {
		stored.exerciseSessions = meso.exerciseSessions;
	}
	return stored;
}

export function compactCyclePlan(plan: CyclePlan): StoredCyclePlan {
	validateCyclePlan(plan);
	const templates = plan.templates.filter(
		(template) => isCustomProtocolId(template.id) || !templateEqualsBundled(template)
	);
	return {
		version: 4,
		revision: plan.revision,
		updatedAt: plan.updatedAt,
		templates,
		macrocycles: plan.macrocycles.map(({ startDate: _start, endDate: _end, ...macro }) => macro),
		mesocycles: plan.mesocycles.map(compactMesocycle)
	};
}

function validateCyclePlan(plan: CyclePlan): CyclePlan {
	const issues: string[] = [];
	const templateIds = new Set(plan.templates.map((template) => template.id));
	const macroIds = new Set<string>();
	const mesoIds = new Set<string>();
	const microIds = new Set<string>();
	const sessionIds = new Set<string>();
	const dates = new Set<string>();

	if (!Number.isInteger(plan.revision) || plan.revision < 0) issues.push('revision должен быть целым >= 0');
	if (!isIsoDateTime(plan.updatedAt)) issues.push('updatedAt должен быть ISO-временем');
	for (const template of plan.templates) {
		if (!template.id || templateIds.size !== plan.templates.length) {
			issues.push('ProtocolTemplate.id должны быть уникальными и непустыми');
			break;
		}
		for (const phase of template.phases) {
			if (!isPositiveNumber(phase.intensityPct) || phase.intensityPct > 150) {
				issues.push(`${template.id}/${phase.id}: intensityPct должен быть в диапазоне (0, 150]`);
			}
			if (
				!Number.isInteger(phase.microFrom) ||
				!Number.isInteger(phase.microTo) ||
				phase.microFrom < 1 ||
				phase.microTo < phase.microFrom
			) {
				issues.push(`${template.id}/${phase.id}: неверный диапазон микроциклов`);
			}
		}
	}
	for (const meso of plan.mesocycles) {
		if (!meso.id || mesoIds.has(meso.id)) issues.push(`дубликат MesocyclePlan.id: ${meso.id}`);
		mesoIds.add(meso.id);
		if (!isBundledProtocolId(meso.templateId) && !templateIds.has(meso.templateId)) {
			issues.push(`${meso.id}: отсутствующий templateId ${meso.templateId}`);
		}
		for (const [exerciseId, value] of Object.entries(meso.anchor1rm)) {
			if (!isPositiveNumber(value)) issues.push(`${meso.id}: неверный anchor1rm для ${exerciseId}`);
		}
		for (const [exerciseId, templateId] of Object.entries(meso.exerciseProtocols ?? {})) {
			if (!isBundledProtocolId(templateId) && !templateIds.has(templateId)) {
				issues.push(`${meso.id}: отсутствующий протокол ${templateId} для ${exerciseId}`);
			}
		}
		for (const [exerciseId, sessions] of Object.entries(meso.exerciseSessions ?? {})) {
			if (!Array.isArray(sessions) || sessions.length === 0) {
				issues.push(`${meso.id}: exerciseSessions[${exerciseId}] должен содержать хотя бы один день`);
				continue;
			}
			for (const sessionIndex of sessions) {
				if (sessionIndex !== 0 && sessionIndex !== 1) {
					issues.push(`${meso.id}: exerciseSessions[${exerciseId}] содержит неверный индекс дня`);
				}
			}
		}
		for (const micro of meso.microcycles) {
			if (!micro.id || microIds.has(micro.id)) issues.push(`дубликат MicrocyclePlan.id: ${micro.id}`);
			microIds.add(micro.id);
			if (!Number.isInteger(micro.indexInMeso) || micro.indexInMeso < 1) {
				issues.push(`${micro.id}: indexInMeso должен быть целым >= 1`);
			}
			if (
				micro.intensityPct != null &&
				(!isPositiveNumber(micro.intensityPct) || micro.intensityPct > 150)
			) {
				issues.push(`${micro.id}: intensityPct должен быть в диапазоне (0, 150]`);
			}
			if (micro.sessions.length !== 2) issues.push(`${micro.id}: должно быть ровно две сессии`);
			if (micro.sessions[0]?.indexInMicro !== 0 || micro.sessions[1]?.indexInMicro !== 1) {
				issues.push(`${micro.id}: обязательны слоты A(0) и B(1)`);
			}
			for (const session of micro.sessions) {
				if (!session.id || sessionIds.has(session.id)) issues.push(`дубликат MicroSessionPlan.id: ${session.id}`);
				sessionIds.add(session.id);
				if (session.date) {
					if (!isIsoDate(session.date)) issues.push(`${session.id}: неверная дата`);
					if (dates.has(session.date)) issues.push(`дата ${session.date} назначена нескольким слотам`);
					dates.add(session.date);
				}
			}
		}
	}
	const assignedMesos = new Set<string>();
	for (const macro of plan.macrocycles) {
		if (!macro.id || macroIds.has(macro.id)) issues.push(`дубликат MacrocyclePlan.id: ${macro.id}`);
		macroIds.add(macro.id);
		for (const id of macro.mesoIds) {
			if (!mesoIds.has(id)) issues.push(`${macro.id}: отсутствующий mesoId ${id}`);
			if (assignedMesos.has(id)) issues.push(`${id}: мезоцикл включён в несколько макроциклов`);
			assignedMesos.add(id);
		}
	}
	if (issues.length) throw new SchemaValidationError('cycle-plan.json', issues);
	return plan;
}

function validateStoredCycleV4(raw: JsonObject): void {
	const issues: string[] = [];
	if (!Number.isInteger(raw.revision) || Number(raw.revision) < 0) {
		issues.push('revision должен быть целым >= 0');
	}
	if (!isIsoDateTime(raw.updatedAt)) issues.push('updatedAt должен быть ISO-временем');
	if (!Array.isArray(raw.templates)) issues.push('templates должен быть массивом');
	if (!Array.isArray(raw.macrocycles)) issues.push('macrocycles должен быть массивом');
	if (!Array.isArray(raw.mesocycles)) issues.push('mesocycles должен быть массивом');

	for (const [index, template] of (Array.isArray(raw.templates) ? raw.templates : []).entries()) {
		if (!isObject(template) || typeof template.id !== 'string' || !Array.isArray(template.phases)) {
			issues.push(`templates[${index}] имеет неверную структуру`);
		}
	}
	for (const [index, macro] of (Array.isArray(raw.macrocycles) ? raw.macrocycles : []).entries()) {
		if (
			!isObject(macro) ||
			typeof macro.id !== 'string' ||
			typeof macro.label !== 'string' ||
			!Array.isArray(macro.mesoIds)
		) {
			issues.push(`macrocycles[${index}] имеет неверную структуру`);
		}
	}
	for (const [mesoIndex, meso] of (Array.isArray(raw.mesocycles) ? raw.mesocycles : []).entries()) {
		if (
			!isObject(meso) ||
			typeof meso.id !== 'string' ||
			typeof meso.label !== 'string' ||
			typeof meso.templateId !== 'string' ||
			!Array.isArray(meso.microcycles)
		) {
			issues.push(`mesocycles[${mesoIndex}] имеет неверную структуру`);
			continue;
		}
		for (const [microIndex, micro] of meso.microcycles.entries()) {
			if (
				!isObject(micro) ||
				typeof micro.id !== 'string' ||
				!Number.isInteger(micro.indexInMeso) ||
				!Array.isArray(micro.sessions) ||
				micro.sessions.length !== 2
			) {
				issues.push(`mesocycles[${mesoIndex}].microcycles[${microIndex}] имеет неверную структуру`);
				continue;
			}
			const indexes = new Set<number>();
			for (const [sessionIndex, session] of micro.sessions.entries()) {
				if (
					!isObject(session) ||
					typeof session.id !== 'string' ||
					(session.indexInMicro !== 0 && session.indexInMicro !== 1) ||
					(session.date != null && !isIsoDate(session.date))
				) {
					issues.push(
						`mesocycles[${mesoIndex}].microcycles[${microIndex}].sessions[${sessionIndex}] имеет неверную структуру`
					);
					continue;
				}
				indexes.add(session.indexInMicro);
			}
			if (!indexes.has(0) || !indexes.has(1)) {
				issues.push(`mesocycles[${mesoIndex}].microcycles[${microIndex}] должен иметь слоты 0 и 1`);
			}
		}
	}
	if (issues.length) throw new SchemaValidationError('cycle-plan.json', issues);
}

export function validateDatabasePlanLinks(db: WorkoutDatabase, plan: CyclePlan | null): void {
	if (!plan) return;
	const sessionIds = new Set(
		plan.mesocycles.flatMap((meso) =>
			meso.microcycles.flatMap((micro) => micro.sessions.map((session) => session.id))
		)
	);
	const issues = db.logs
		.filter((log) => log.microSessionId && !sessionIds.has(log.microSessionId))
		.map((log) => `${log.id}: отсутствующий microSessionId ${log.microSessionId}`);
	if (issues.length) throw new SchemaValidationError('workouts + cycle-plan', issues);
}

function migrateStoredCyclePlan(raw: JsonObject): CyclePlan {
	const templates = Array.isArray(raw.templates) ? (raw.templates as ProtocolTemplate[]) : [];
	const mesocyclesRaw = Array.isArray(raw.mesocycles) ? raw.mesocycles.filter(isObject) : [];
	const mesocycles: MesocyclePlan[] = mesocyclesRaw.map((meso) => {
		const microcycles = normalizeMicrocycles(
			Array.isArray(meso.microcycles) ? (meso.microcycles as MicrocyclePlan[]) : []
		);
		const range = mesoDateRange(
			microcycles,
			text(meso.plannedStartDate, text(meso.startDate)),
			text(meso.plannedEndDate, text(meso.endDate))
		);
		return {
			id: text(meso.id),
			label: text(meso.label),
			startDate: range.startDate,
			endDate: range.endDate,
			microcycles,
			templateId: text(meso.templateId),
			anchor1rm: isObject(meso.anchor1rm) ? (meso.anchor1rm as Record<string, number>) : {},
			anchor1rmManual: isObject(meso.anchor1rmManual)
				? (meso.anchor1rmManual as Record<string, boolean>)
				: {},
			exerciseProtocols: isObject(meso.exerciseProtocols)
				? (meso.exerciseProtocols as Record<string, string>)
				: undefined,
			exerciseSessions: isObject(meso.exerciseSessions)
				? (meso.exerciseSessions as Record<string, (0 | 1)[]>)
				: undefined
		};
	});
	const byMesoId = new Map(mesocycles.map((meso) => [meso.id, meso]));
	const macrocyclesRaw = Array.isArray(raw.macrocycles) ? raw.macrocycles.filter(isObject) : [];
	const macrocycles: MacrocyclePlan[] = macrocyclesRaw.map((macro) => {
		const mesoIds = Array.isArray(macro.mesoIds)
			? macro.mesoIds.filter((id): id is string => typeof id === 'string')
			: [];
		const referenced = mesoIds.map((id) => byMesoId.get(id)).filter((item): item is MesocyclePlan => Boolean(item));
		return {
			id: text(macro.id),
			label: text(macro.label),
			startDate: referenced[0]?.startDate ?? text(macro.startDate),
			endDate: referenced[referenced.length - 1]?.endDate ?? text(macro.endDate),
			mesoIds,
			note: typeof macro.note === 'string' ? macro.note : undefined
		};
	});
	return validateCyclePlan({
		version: 4,
		revision: Number.isInteger(raw.revision) ? Number(raw.revision) : 0,
		updatedAt: text(raw.updatedAt),
		templates,
		macrocycles,
		mesocycles
	});
}

export function normalizeStoredCyclePlan(raw: unknown): CyclePlan | null {
	if (!isObject(raw)) throw new SchemaValidationError('cycle-plan.json', ['корень должен быть объектом']);
	if (raw.version !== 3 && raw.version !== 4) {
		throw new SchemaValidationError('cycle-plan.json', [`неподдерживаемая версия: ${String(raw.version)}`]);
	}
	if (raw.version === 4) validateStoredCycleV4(raw);
	return migrateStoredCyclePlan(raw);
}

export function stringifyCompact(value: unknown): string {
	return JSON.stringify(value);
}

export function parseJson<T = unknown>(raw: string): T {
	return JSON.parse(raw) as T;
}
