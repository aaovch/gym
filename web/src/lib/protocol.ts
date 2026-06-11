import type { WorkoutEntry } from './types';

export function epley1rm(weight: number, reps: number): number {
	return weight * (1 + reps / 30);
}

export type Best1rmHit = {
	value: number;
	weight: number;
	reps: number;
	date: string;
};

function best1rmFromEntries(
	entries: WorkoutEntry[],
	exercise: string,
	predicate: (date: string) => boolean
): Best1rmHit | null {
	let best: Best1rmHit | null = null;
	for (const entry of entries) {
		if (entry.exercise !== exercise || !predicate(entry.date)) continue;
		for (const [weight, reps] of entry.sets) {
			const value = epley1rm(weight, reps);
			if (!best || value > best.value) {
				best = {
					value: Math.round(value * 10) / 10,
					weight,
					reps,
					date: entry.date
				};
			}
		}
	}
	return best;
}

/** Лучший 1ПМ (Эпли) строго до даты (не включая день). */
export function best1rmBeforeDate(
	entries: WorkoutEntry[],
	exercise: string,
	beforeDate: string
): Best1rmHit | null {
	return best1rmFromEntries(entries, exercise, (date) => date < beforeDate);
}

/** Лучший 1ПМ в диапазоне дат включительно. */
export function best1rmInRange(
	entries: WorkoutEntry[],
	exercise: string,
	startDate: string,
	endDate: string
): Best1rmHit | null {
	return best1rmFromEntries(
		entries,
		exercise,
		(date) => date >= startDate && date <= endDate
	);
}

export type MesoAnchorSource = 'prior' | 'in_meso' | 'manual';

export type MesoAnchor1rm = {
	value: number;
	source: MesoAnchorSource;
	/** Дата сета, из которого взят 1ПМ. */
	asOfDate: string | null;
};

/**
 * Якорь на старт мезоцикла:
 * 1) лучший 1ПМ до начала блока (включая прошлый мезо);
 * 2) если истории нет — лучший за текущий мезо (первый блок).
 */
export function resolveMesoAnchor1rm(
	entries: WorkoutEntry[],
	exercise: string,
	mesoStart: string,
	mesoEnd: string
): MesoAnchor1rm | null {
	const prior = best1rmBeforeDate(entries, exercise, mesoStart);
	if (prior) {
		return { value: prior.value, source: 'prior', asOfDate: prior.date };
	}
	const inMeso = best1rmInRange(entries, exercise, mesoStart, mesoEnd);
	if (inMeso) {
		return { value: inMeso.value, source: 'in_meso', asOfDate: inMeso.date };
	}
	return null;
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

/** Плоский протокол — одна рабочая интенсивность на весь мезоцикл. */
export const STABLE_PROTOCOL_TEMPLATE: ProtocolTemplate = {
	id: 'stable-80',
	name: 'Стабильный ~80%',
	phases: [{ id: 's1', label: 'Рабочий', intensityPct: 80, microFrom: 1, microTo: 12 }]
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

/** @deprecated используй best1rmBeforeDate */
export function anchor1rmBeforeDate(
	entries: WorkoutEntry[],
	exercise: string,
	beforeDate: string
): number | null {
	return best1rmBeforeDate(entries, exercise, beforeDate)?.value ?? null;
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
	protocolLabel?: string;
	/** Нет записи в этом микро — показана только цель по протоколу. */
	plannedOnly?: boolean;
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
const CARDIO_RE = /бег|кардио|элипс/i;

export function isCardioExercise(name: string): boolean {
	return CARDIO_RE.test(name);
}

/** Все силовые упражнения мезо (без кардио), базовые — первыми. */
export function pickMesoExercises(exercises: string[]): string[] {
	return exercises
		.filter((name) => !isCardioExercise(name))
		.sort((a, b) => {
			const aCompound = COMPOUND_RE.test(a) ? 0 : 1;
			const bCompound = COMPOUND_RE.test(b) ? 0 : 1;
			if (aCompound !== bCompound) return aCompound - bCompound;
			return a.localeCompare(b, 'ru');
		});
}

/** @deprecated используй pickMesoExercises */
export function pickAnchorExercises(exercises: string[], limit?: number): string[] {
	const picked = pickMesoExercises(exercises);
	return limit ? picked.slice(0, limit) : picked;
}

export function shortExerciseName(name: string): string {
	if (name.includes('Приседания')) return 'присед';
	if (name.includes('Сплит')) return 'сплит';
	if (name.includes('лендмайн')) return 'лендмайн';
	if (name.includes('Жим гантелей лёжа')) return 'жим лёжа';
	if (name.includes('Румынская')) return 'RDL';
	if (name.includes('Горизонтальная тяга')) return 'тяга';
	if (name.includes('Вертикальная тяга')) return 'тяга V';
	if (name.includes('Вертикальный жим')) return 'жим V';
	if (name.includes('Скручивания')) return 'пресс';
	return name.split(' ').slice(0, 2).join(' ').toLowerCase();
}

export function newPhaseId(): string {
	return `phase-${crypto.randomUUID().slice(0, 8)}`;
}

export function newTemplateId(): string {
	return `tpl-${crypto.randomUUID().slice(0, 8)}`;
}

export function plannedSessionIntensity(
	exercise: string,
	anchor1rm: number,
	targetPct: number,
	protocolLabel?: string
): SessionIntensity {
	return {
		exercise,
		date: '',
		anchor1rm,
		targetPct,
		targetWeight: targetWeight(anchor1rm, targetPct),
		avgWeight: 0,
		maxWeight: 0,
		avgPct: 0,
		maxPct: 0,
		protocolLabel,
		plannedOnly: true
	};
}
