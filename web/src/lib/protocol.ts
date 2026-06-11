import type { WorkoutEntry } from './types';

export function epley1rm(weight: number, reps: number): number {
	return weight * (1 + reps / 30);
}

export type ProtocolPhase = {
	id: string;
	label: string;
	/** Целевая интенсивность в % от 1ПМ (80 = 80% от 1ПМ). */
	intensityPct: number;
	/** Первый микроцикл фазы (1-based). */
	microFrom: number;
	/** Последний микроцикл фазы (1-based). */
	microTo: number;
};

export type ProtocolTemplate = {
	id: string;
	name: string;
	phases: ProtocolPhase[];
};

export const DEFAULT_PROTOCOL_TEMPLATE: ProtocolTemplate = {
	id: 'linear-4',
	name: 'Линейный 4×микро',
	phases: [
		{ id: 'p1', label: 'Втягивание', intensityPct: 75, microFrom: 1, microTo: 1 },
		{ id: 'p2', label: 'Накопление', intensityPct: 80, microFrom: 2, microTo: 2 },
		{ id: 'p3', label: 'Интенсификация', intensityPct: 85, microFrom: 3, microTo: 3 },
		{ id: 'p4', label: 'Разгрузка', intensityPct: 70, microFrom: 4, microTo: 4 }
	]
};

export function phaseForMicro(template: ProtocolTemplate, microIndex: number): ProtocolPhase | null {
	return (
		template.phases.find(
			(phase) => microIndex >= phase.microFrom && microIndex <= phase.microTo
		) ?? null
	);
}

export function targetWeight(anchor1rm: number, intensityPct: number): number {
	return Math.round((anchor1rm * intensityPct) / 100 * 2) / 2;
}

export function intensityPctOf1rm(weight: number, anchor1rm: number): number | null {
	if (!anchor1rm) return null;
	return Math.round((weight / anchor1rm) * 1000) / 10;
}

export function anchor1rmBeforeDate(
	entries: WorkoutEntry[],
	exercise: string,
	beforeDate: string
): number | null {
	let best = 0;
	for (const entry of entries) {
		if (entry.exercise !== exercise || entry.date >= beforeDate) continue;
		for (const [weight, reps] of entry.sets) {
			best = Math.max(best, epley1rm(weight, reps));
		}
	}
	return best > 0 ? Math.round(best * 10) / 10 : null;
}

export type SessionIntensity = {
	exercise: string;
	date: string;
	anchor1rm: number;
	targetPct: number;
	targetWeight: number;
	avgWeight: number;
	maxWeight: number;
	avgPct: number;
	maxPct: number;
};

export function sessionIntensity(
	entry: WorkoutEntry,
	anchor1rm: number,
	targetPct: number
): SessionIntensity | null {
	if (!entry.sets.length || !anchor1rm) return null;
	const tonnage = entry.sets.reduce((sum, [w, r]) => sum + w * r, 0);
	const reps = entry.sets.reduce((sum, [, r]) => sum + r, 0);
	const avgWeight = reps ? tonnage / reps : 0;
	const maxWeight = Math.max(...entry.sets.map(([w]) => w));
	return {
		exercise: entry.exercise,
		date: entry.date,
		anchor1rm,
		targetPct,
		targetWeight: targetWeight(anchor1rm, targetPct),
		avgWeight: Math.round(avgWeight * 10) / 10,
		maxWeight,
		avgPct: intensityPctOf1rm(avgWeight, anchor1rm) ?? 0,
		maxPct: intensityPctOf1rm(maxWeight, anchor1rm) ?? 0
	};
}

const COMPOUND_RE =
	/присед|жим|тяга|румынск|лендмайн|сплит|станов|выпад|подтяг|отжим/i;

export function pickAnchorExercises(exercises: string[], limit = 2): string[] {
	return exercises.filter((name) => COMPOUND_RE.test(name)).slice(0, limit);
}

export function newPhaseId(): string {
	return `phase-${crypto.randomUUID().slice(0, 8)}`;
}

export function newTemplateId(): string {
	return `tpl-${crypto.randomUUID().slice(0, 8)}`;
}
