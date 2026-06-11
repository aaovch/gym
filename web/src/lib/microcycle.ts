import { TRAINING_GAP_DAYS, dateToMs } from './chart-time';
import type { WorkoutSession } from './types';

const CARDIO_RE = /бег|кардио|элипс/i;

export type WorkoutSlot = 'A' | 'B' | 'unknown';

export type TrainingDay = {
	date: string;
	exercises: string[];
	slot: WorkoutSlot;
	confidence: number;
};

export type WorkoutTemplate = {
	slot: WorkoutSlot;
	label: string;
	exercises: string[];
	sessions: number;
};

export type Microcycle = {
	index: number;
	startDate: string;
	endDate: string;
	days: TrainingDay[];
	dayA: TrainingDay | null;
	dayB: TrainingDay | null;
	complete: boolean;
	gapAfterDays: number | null;
};

export type MicrocycleOverview = {
	templates: WorkoutTemplate[];
	days: TrainingDay[];
	cycles: Microcycle[];
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
): Pick<TrainingDay, 'slot' | 'confidence'> {
	const set = new Set(exercises.filter((item) => !isCardio(item)));
	if (set.size === 0) return { slot: 'unknown', confidence: 0 };

	const scoreA = jaccard(set, centroidA);
	const scoreB = jaccard(set, centroidB);
	const minMatch = 0.28;

	if (scoreA < minMatch && scoreB < minMatch) return { slot: 'unknown', confidence: Math.max(scoreA, scoreB) };
	if (scoreA >= scoreB) return { slot: 'A', confidence: scoreA };
	return { slot: 'B', confidence: scoreB };
}

function buildMicrocycles(days: TrainingDay[]): Microcycle[] {
	const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
	const cycles: Microcycle[] = [];
	let bucket: TrainingDay[] = [];

	const flush = () => {
		if (bucket.length === 0) return;
		const dayA = bucket.find((day) => day.slot === 'A') ?? null;
		const dayB = bucket.find((day) => day.slot === 'B') ?? null;
		cycles.push({
			index: cycles.length + 1,
			startDate: bucket[0].date,
			endDate: bucket[bucket.length - 1].date,
			days: bucket,
			dayA,
			dayB,
			complete: Boolean(dayA && dayB),
			gapAfterDays: null
		});
		bucket = [];
	};

	for (const day of sorted) {
		if (bucket.length > 0) {
			const gap = daysBetween(bucket[bucket.length - 1].date, day.date);
			const hasA = bucket.some((item) => item.slot === 'A');
			const hasB = bucket.some((item) => item.slot === 'B');

			if (gap > TRAINING_GAP_DAYS) {
				flush();
			} else if (hasA && hasB && day.slot === 'A') {
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

export function buildMicrocycleOverview(sessions: WorkoutSession[]): MicrocycleOverview {
	const dayGroups = groupSessionsByDate(sessions);
	const [centroidA, centroidB] = detectTemplates(dayGroups);

	const days: TrainingDay[] = dayGroups.map((day) => ({
		date: day.date,
		exercises: day.exercises,
		...classifyDay(day.exercises, centroidA, centroidB)
	}));

	const countA = days.filter((day) => day.slot === 'A').length;
	const countB = days.filter((day) => day.slot === 'B').length;

	const templates: WorkoutTemplate[] = [
		{
			slot: 'A',
			label: templateLabel(centroidA, centroidB),
			exercises: [...centroidA].sort((a, b) => a.localeCompare(b, 'ru')),
			sessions: countA
		},
		{
			slot: 'B',
			label: templateLabel(centroidB, centroidA),
			exercises: [...centroidB].sort((a, b) => a.localeCompare(b, 'ru')),
			sessions: countB
		}
	];

	const cycles = buildMicrocycles(days.filter((day) => day.slot !== 'unknown'));
	const byDate = new Map(days.map((day) => [day.date, day]));

	return { templates, days, cycles, byDate };
}

export function microcycleForDate(cycles: Microcycle[], date: string): Microcycle | null {
	return cycles.find((cycle) => date >= cycle.startDate && date <= cycle.endDate) ?? null;
}

export function slotLabel(slot: WorkoutSlot): string {
	if (slot === 'A') return 'Тренировка A';
	if (slot === 'B') return 'Тренировка B';
	return 'Не определено';
}

export function slotColor(slot: WorkoutSlot): string {
	if (slot === 'A') return '#5b9dff';
	if (slot === 'B') return '#6ee7a8';
	return '#94a3b8';
}
