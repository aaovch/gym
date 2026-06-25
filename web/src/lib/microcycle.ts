import { TRAINING_GAP_DAYS, dateToMs } from './chart-time';
import type { WorkoutSession } from './types';

const CARDIO_RE = /бег|кардио|элипс/i;

/** Элемент микроцикла — один визит в зал (0 = «A», 1 = «B» в UI). */
export type TrainingDay = {
	date: string;
	exercises: string[];
	indexInMicro: number;
	confidence: number;
};

export type WorkoutTemplate = {
	indexInMicro: number;
	label: string;
	exercises: string[];
	sessions: number;
};

export type Microcycle = {
	index: number;
	mesoIndex: number;
	indexInMeso: number;
	startDate: string;
	endDate: string;
	days: TrainingDay[];
	sessions: [TrainingDay | null, TrainingDay | null];
	/** @deprecated используй sessions[0] */
	dayA: TrainingDay | null;
	/** @deprecated используй sessions[1] */
	dayB: TrainingDay | null;
	complete: boolean;
	gapAfterDays: number | null;
};

/** Перерыв между микроциклами, с которого начинаем новый мезоблок. */
export const MESOCYCLE_GAP_DAYS = 14;

/** Типичная длина мезоцикла в полных микроциклах A+B. */
export const MESOCYCLE_TARGET_MICROS = 4;

/** Максимальная длительность мезоцикла по календарю. */
export const MESOCYCLE_MAX_DAYS = 42;

export type Mesocycle = {
	index: number;
	startDate: string;
	endDate: string;
	durationDays: number;
	microcycles: Microcycle[];
	completeMicrocycles: number;
	label: string;
	gapAfterDays: number | null;
};

export type MicrocycleOverview = {
	templates: WorkoutTemplate[];
	days: TrainingDay[];
	cycles: Microcycle[];
	mesocycles: Mesocycle[];
	byDate: Map<string, TrainingDay>;
};

function isCardio(exercise: string): boolean {
	return CARDIO_RE.test(exercise);
}

function daysBetween(a: string, b: string): number {
	return Math.round((dateToMs(b) - dateToMs(a)) / 86400000);
}

function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 && b.size === 0) return 1;
	let inter = 0;
	for (const item of a) if (b.has(item)) inter++;
	const union = new Set([...a, ...b]).size;
	return union ? inter / union : 0;
}

function unionSets(sets: Set<string>[]): Set<string> {
	const out = new Set<string>();
	for (const set of sets) for (const item of set) out.add(item);
	return out;
}

function shortExerciseName(name: string): string {
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

function templateLabel(template: Set<string>, other: Set<string>): string {
	const unique = [...template].filter((item) => !other.has(item) && !isCardio(item));
	if (unique.length === 0) return 'смешанная';
	return unique.slice(0, 2).map(shortExerciseName).join(' + ');
}

function groupSessionsByDate(sessions: WorkoutSession[]): { date: string; exercises: string[] }[] {
	const map = new Map<string, Set<string>>();
	for (const session of sessions) {
		if (!map.has(session.date)) map.set(session.date, new Set());
		map.get(session.date)!.add(session.exercise);
	}
	return [...map.entries()]
		.map(([date, exercises]) => ({ date, exercises: [...exercises].sort((a, b) => a.localeCompare(b, 'ru')) }))
		.sort((a, b) => a.date.localeCompare(b.date));
}

function detectTemplates(dayGroups: { date: string; exercises: string[] }[]): [Set<string>, Set<string>] {
	const profiles = dayGroups
		.map((day) => ({
			date: day.date,
			set: new Set(day.exercises.filter((item) => !isCardio(item)))
		}))
		.filter((profile) => profile.set.size >= 3);

	if (profiles.length < 2) return [new Set(), new Set()];

	let centroidA = profiles[0].set;
	let centroidB = profiles[1].set;
	let bestDistance = -1;
	for (let i = 0; i < profiles.length; i++) {
		for (let j = i + 1; j < profiles.length; j++) {
			const distance = 1 - jaccard(profiles[i].set, profiles[j].set);
			if (distance > bestDistance) {
				bestDistance = distance;
				centroidA = profiles[i].set;
				centroidB = profiles[j].set;
			}
		}
	}

	for (let iter = 0; iter < 12; iter++) {
		const groupA: Set<string>[] = [];
		const groupB: Set<string>[] = [];
		for (const profile of profiles) {
			if (jaccard(profile.set, centroidA) >= jaccard(profile.set, centroidB)) groupA.push(profile.set);
			else groupB.push(profile.set);
		}
		if (groupA.length === 0 || groupB.length === 0) break;
		const nextA = unionSets(groupA);
		const nextB = unionSets(groupB);
		if (jaccard(nextA, centroidA) > 0.97 && jaccard(nextB, centroidB) > 0.97) break;
		centroidA = nextA;
		centroidB = nextB;
	}

	return [centroidA, centroidB];
}

function classifyDay(
	exercises: string[],
	centroidA: Set<string>,
	centroidB: Set<string>
): Pick<TrainingDay, 'indexInMicro' | 'confidence'> {
	const set = new Set(exercises.filter((item) => !isCardio(item)));
	if (set.size === 0) return { indexInMicro: -1, confidence: 0 };

	const scoreA = jaccard(set, centroidA);
	const scoreB = jaccard(set, centroidB);
	const minMatch = 0.28;

	if (scoreA < minMatch && scoreB < minMatch) return { indexInMicro: -1, confidence: Math.max(scoreA, scoreB) };
	if (scoreA >= scoreB) return { indexInMicro: 0, confidence: scoreA };
	return { indexInMicro: 1, confidence: scoreB };
}

function microSessionsFromDays(days: TrainingDay[]): [TrainingDay | null, TrainingDay | null] {
	return [days.find((day) => day.indexInMicro === 0) ?? null, days.find((day) => day.indexInMicro === 1) ?? null];
}

function buildMicrocycles(days: TrainingDay[]): Microcycle[] {
	const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
	const cycles: Microcycle[] = [];
	let bucket: TrainingDay[] = [];

	const flush = () => {
		if (bucket.length === 0) return;
		const sessions = microSessionsFromDays(bucket);
		cycles.push({
			index: cycles.length + 1,
			mesoIndex: 0,
			indexInMeso: 0,
			startDate: bucket[0].date,
			endDate: bucket[bucket.length - 1].date,
			days: bucket,
			sessions,
			dayA: sessions[0],
			dayB: sessions[1],
			complete: Boolean(sessions[0] && sessions[1]),
			gapAfterDays: null
		});
		bucket = [];
	};

	for (const day of sorted) {
		if (bucket.length > 0) {
			const gap = daysBetween(bucket[bucket.length - 1].date, day.date);
			const has0 = bucket.some((item) => item.indexInMicro === 0);
			const has1 = bucket.some((item) => item.indexInMicro === 1);

			if (gap > TRAINING_GAP_DAYS) {
				flush();
			} else if (has0 && has1 && day.indexInMicro === 0) {
				flush();
			}
		}
		bucket.push(day);
	}
	flush();

	for (let i = 0; i < cycles.length - 1; i++) {
		cycles[i].gapAfterDays = daysBetween(cycles[i].endDate, cycles[i + 1].startDate);
	}

	return cycles;
}

export function mesocycleDisplayLabel(index: number): string {
	return `Мезоцикл ${index}`;
}

function buildMesocycles(cycles: Microcycle[]): Mesocycle[] {
	const mesocycles: Mesocycle[] = [];
	let bucket: Microcycle[] = [];

	const flush = () => {
		if (bucket.length === 0) return;
		const startDate = bucket[0].startDate;
		const endDate = bucket[bucket.length - 1].endDate;
		const mesoIndex = mesocycles.length + 1;
		const microcycles = bucket.map((micro, index) => ({
			...micro,
			mesoIndex,
			indexInMeso: index + 1
		}));

		mesocycles.push({
			index: mesoIndex,
			startDate,
			endDate,
			durationDays: daysBetween(startDate, endDate),
			microcycles,
			completeMicrocycles: microcycles.filter((micro) => micro.complete).length,
			label: mesocycleDisplayLabel(mesoIndex),
			gapAfterDays: null
		});
		bucket = [];
	};

	for (const micro of cycles) {
		if (bucket.length > 0) {
			const last = bucket[bucket.length - 1];
			const gap = last.gapAfterDays ?? daysBetween(last.endDate, micro.startDate);
			const mesoSpan = daysBetween(bucket[0].startDate, micro.startDate);
			const completeInMeso = bucket.filter((item) => item.complete).length;

			if (
				gap >= MESOCYCLE_GAP_DAYS ||
				completeInMeso >= MESOCYCLE_TARGET_MICROS ||
				mesoSpan >= MESOCYCLE_MAX_DAYS
			) {
				flush();
			}
		}
		bucket.push(micro);
	}
	flush();

	for (let i = 0; i < mesocycles.length - 1; i++) {
		mesocycles[i].gapAfterDays = daysBetween(mesocycles[i].endDate, mesocycles[i + 1].startDate);
	}

	return mesocycles;
}

function attachMesocycles(cycles: Microcycle[], mesocycles: Mesocycle[]): Microcycle[] {
	const byIndex = new Map<number, Microcycle>();
	for (const meso of mesocycles) {
		for (const micro of meso.microcycles) {
			byIndex.set(micro.index, micro);
		}
	}
	return cycles.map((micro) => byIndex.get(micro.index) ?? micro);
}

export function buildMicrocycleOverview(sessions: WorkoutSession[]): MicrocycleOverview {
	const dayGroups = groupSessionsByDate(sessions);
	const [centroidA, centroidB] = detectTemplates(dayGroups);

	const days: TrainingDay[] = dayGroups.map((day) => ({
		date: day.date,
		exercises: day.exercises,
		...classifyDay(day.exercises, centroidA, centroidB)
	}));

	const count0 = days.filter((day) => day.indexInMicro === 0).length;
	const count1 = days.filter((day) => day.indexInMicro === 1).length;

	const templates: WorkoutTemplate[] = [
		{
			indexInMicro: 0,
			label: templateLabel(centroidA, centroidB),
			exercises: [...centroidA].sort((a, b) => a.localeCompare(b, 'ru')),
			sessions: count0
		},
		{
			indexInMicro: 1,
			label: templateLabel(centroidB, centroidA),
			exercises: [...centroidB].sort((a, b) => a.localeCompare(b, 'ru')),
			sessions: count1
		}
	];

	const rawCycles = buildMicrocycles(days.filter((day) => day.indexInMicro >= 0));
	const mesocycles = buildMesocycles(rawCycles);
	const cycles = attachMesocycles(rawCycles, mesocycles);
	const byDate = new Map(days.map((day) => [day.date, day]));

	return { templates, days, cycles, mesocycles, byDate };
}

export function microcycleForDate(cycles: Microcycle[], date: string): Microcycle | null {
	return cycles.find((cycle) => date >= cycle.startDate && date <= cycle.endDate) ?? null;
}

export function mesocycleForDate(mesocycles: Mesocycle[], date: string): Mesocycle | null {
	return mesocycles.find((meso) => date >= meso.startDate && date <= meso.endDate) ?? null;
}

export function sessionIndexLabel(indexInMicro: number): string {
	if (indexInMicro === 0) return 'Тренировка A';
	if (indexInMicro === 1) return 'Тренировка B';
	return `День ${indexInMicro + 1}`;
}

export function sessionIndexColor(indexInMicro: number): string {
	if (indexInMicro === 0) return '#5b9dff';
	if (indexInMicro === 1) return '#ccff33';
	return '#94a3b8';
}

/** @deprecated используй indexInMicro */
export type WorkoutSlot = 'A' | 'B' | 'unknown';

export function slotToIndex(slot: WorkoutSlot): number {
	if (slot === 'A') return 0;
	if (slot === 'B') return 1;
	return -1;
}

export function indexToSlot(indexInMicro: number): WorkoutSlot {
	if (indexInMicro === 0) return 'A';
	if (indexInMicro === 1) return 'B';
	return 'unknown';
}

export function slotLabel(slot: WorkoutSlot): string {
	return sessionIndexLabel(slotToIndex(slot));
}

export function slotColor(slot: WorkoutSlot): string {
	return sessionIndexColor(slotToIndex(slot));
}

export function mesocycleColor(index: number): string {
	const palette = ['#a78bfa', '#fbbf24', '#34d399', '#f472b6', '#5b9dff', '#fb923c'];
	return palette[(index - 1) % palette.length];
}
