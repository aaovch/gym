export type SessionRow = {
	sets: [number, number][];
	comment?: string | null;
};

export type WorkoutSession = {
	id: string;
	exercise: string;
	date: string;
	rows: SessionRow[];
};

export type WorkoutDatabase = {
	version: 1;
	updatedAt: string;
	sessions: WorkoutSession[];
};

export type ExerciseKind = 'strength' | 'run' | 'jumps';

export type WorkoutEntry = {
	id?: string;
	exercise: string;
	date: string;
	parts: string[];
	sets: [number, number][];
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
	weight: string;
	reps: string;
};

export type RowInput = {
	sets: SetInput[];
	comment: string;
};
