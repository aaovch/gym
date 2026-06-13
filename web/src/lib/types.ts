import type { MovementBlockId } from './muscle-groups';

export type StrengthSet = [weightKg: number, reps: number];
export type RunSet = [durationMin: number, speedKmh: number];
export type JumpSet = [setCount: number, repsPerSet: number];
export type ExerciseSet = StrengthSet | RunSet | JumpSet;

export type SessionRow = {
	kind: ExerciseKind;
	sets: ExerciseSet[];
	comment?: string | null;
};

/** Блок подходов внутри записи по упражнению. */
export type SetBlock = SessionRow;

export type ExerciseKind = 'strength' | 'run' | 'jumps';

export type Exercise = {
	id: string;
	name: string;
	kind: ExerciseKind;
	movementBlocks: MovementBlockId[];
};

/** Факт выполнения упражнения (раньше WorkoutSession). */
export type ExerciseLog = {
	id: string;
	exerciseId: string;
	date: string;
	blocks: SetBlock[];
	microSessionId?: string;
};

export type WorkoutDatabase = {
	version: 4;
	revision: number;
	updatedAt: string;
	exercises: Exercise[];
	logs: ExerciseLog[];
};

/** Развёрнутый вид записи для stats/UI (exercise = имя из каталога). */
export type WorkoutSession = {
	id: string;
	exerciseId: string;
	exercise: string;
	date: string;
	rows: SessionRow[];
	microSessionId?: string;
};

export type WorkoutEntry = {
	id?: string;
	exerciseId?: string;
	exercise: string;
	kind: ExerciseKind;
	date: string;
	parts: string[];
	sets: ExerciseSet[];
	microSessionId?: string;
};

export type StrengthSummary = {
	exercise: string;
	kind: 'strength';
	sessions: number;
	sets: number;
	reps: number;
	tonnage: number;
	periodStart: string | null;
	periodEnd: string | null;
	avgIntensity: number;
	best1rm: { value: number; weight: number; reps: number; date: string | null };
	bestWeight: { weight: number; reps: number; date: string | null };
	best5: { weight: number; reps: number; date: string | null } | null;
};

export type TrendPoint = {
	date: string;
	est1rm: number;
	maxWeight: number;
	maxReps: number;
	avgIntensity: number;
};

export type SetInput = {
	id: string;
	weight: string;
	reps: string;
};

export type RowInput = {
	sets: SetInput[];
	comment: string;
};
