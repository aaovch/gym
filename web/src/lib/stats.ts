import type { SetPair } from './markdown';
import type { StrengthSummary, TrendPoint, WorkoutEntry } from './types';

function epley1rm(weight: number, reps: number): number {
	return weight * (1 + reps / 30);
}

function bestSetByWeight(sets: SetPair[]): SetPair {
	return sets.reduce((best, current) =>
		current[0] > best[0] || (current[0] === best[0] && current[1] > best[1]) ? current : best
	);
}

function bestSetBy1rm(sets: SetPair[]): [number, number, number] {
	let best = sets[0];
	let bestValue = epley1rm(best[0], best[1]);
	for (const set of sets.slice(1)) {
		const value = epley1rm(set[0], set[1]);
		if (value > bestValue) {
			best = set;
			bestValue = value;
		}
	}
	return [best[0], best[1], bestValue];
}

function bestSetNearReps(sets: SetPair[], low: number, high: number): SetPair | null {
	const candidates = sets.filter(([, reps]) => reps >= low && reps <= high);
	if (candidates.length === 0) return null;
	return bestSetByWeight(candidates);
}

function exerciseChartKind(name: string): 'strength' | 'run' | 'jumps' {
	const lower = name.toLowerCase();
	if (lower.includes('бег')) return 'run';
	if (lower.includes('прыж')) return 'jumps';
	return 'strength';
}

function computeEntryMetrics(sets: SetPair[]) {
	const tonnage = sets.reduce((sum, [weight, reps]) => sum + weight * reps, 0);
	const maxWeightSet = bestSetByWeight(sets);
	const best1rm = bestSetBy1rm(sets);
	const totalReps = sets.reduce((sum, [, reps]) => sum + reps, 0);
	return {
		tonnage,
		maxWeight: maxWeightSet[0],
		maxWeightSet,
		est1rm: best1rm[2],
		est1rmSet: [best1rm[0], best1rm[1]] as SetPair,
		best5: bestSetNearReps(sets, 4, 6),
		reps: totalReps,
		sets: sets.length,
		avgIntensity: totalReps ? tonnage / totalReps : 0
	};
}

export function buildWorkoutData(entries: WorkoutEntry[]) {
	const summaryMap = new Map<
		string,
		{
			exercise: string;
			kind: 'strength' | 'run' | 'jumps';
			sessions: number;
			sets: number;
			reps: number;
			tonnage: number;
			avgIntensitySum: number;
			maxWeight: [number, number | null, string | null];
			best1rm: [number, SetPair | null, string | null];
			best5: [number, number | null, string | null];
			dates: string[];
		}
	>();

	const trendMap = new Map<string, Map<string, TrendPoint>>();

	for (const entry of entries) {
		const metrics = computeEntryMetrics(entry.sets);
		const kind = exerciseChartKind(entry.exercise);

		if (!summaryMap.has(entry.exercise)) {
			summaryMap.set(entry.exercise, {
				exercise: entry.exercise,
				kind,
				sessions: 0,
				sets: 0,
				reps: 0,
				tonnage: 0,
				avgIntensitySum: 0,
				maxWeight: [0, null, null],
				best1rm: [0, null, null],
				best5: [0, null, null],
				dates: []
			});
		}

		const group = summaryMap.get(entry.exercise)!;
		group.sessions += 1;
		group.sets += metrics.sets;
		group.reps += metrics.reps;
		group.tonnage += metrics.tonnage;
		group.avgIntensitySum += metrics.avgIntensity;
		group.dates.push(entry.date);

		if (metrics.maxWeight > group.maxWeight[0]) {
			group.maxWeight = [metrics.maxWeight, metrics.maxWeightSet[1], entry.date];
		}
		if (metrics.est1rm > group.best1rm[0]) {
			group.best1rm = [metrics.est1rm, metrics.est1rmSet, entry.date];
		}
		if (metrics.best5 && metrics.best5[0] > group.best5[0]) {
			group.best5 = [metrics.best5[0], metrics.best5[1], entry.date];
		}

		if (!trendMap.has(entry.exercise)) trendMap.set(entry.exercise, new Map());
		trendMap.get(entry.exercise)!.set(entry.date, {
			date: entry.date,
			est1rm: Math.round(metrics.est1rm * 10) / 10,
			maxWeight: metrics.maxWeightSet[0],
			maxReps: metrics.maxWeightSet[1],
			avgIntensity: Math.round(metrics.avgIntensity * 10) / 10
		});
	}

	const summary: StrengthSummary[] = [...summaryMap.values()]
		.filter((group) => group.kind === 'strength')
		.sort((a, b) => a.exercise.localeCompare(b.exercise, 'ru'))
		.map((group) => ({
			exercise: group.exercise,
			kind: 'strength' as const,
			sessions: group.sessions,
			sets: group.sets,
			reps: group.reps,
			tonnage: Math.round(group.tonnage * 10) / 10,
			periodStart: group.dates.length ? group.dates.reduce((a, b) => (a < b ? a : b)) : null,
			periodEnd: group.dates.length ? group.dates.reduce((a, b) => (a > b ? a : b)) : null,
			avgIntensity: group.sessions
				? Math.round((group.avgIntensitySum / group.sessions) * 10) / 10
				: 0,
			best1rm: {
				value: Math.round(group.best1rm[0] * 10) / 10,
				weight: group.best1rm[1]?.[0] ?? 0,
				reps: group.best1rm[1]?.[1] ?? 0,
				date: group.best1rm[2]
			},
			bestWeight: {
				weight: group.maxWeight[0],
				reps: group.maxWeight[1] ?? 0,
				date: group.maxWeight[2]
			},
			best5: group.best5[1]
				? {
						weight: group.best5[0],
						reps: group.best5[1],
						date: group.best5[2]
					}
				: null
		}));

	const trend: Record<string, TrendPoint[]> = {};
	for (const [exercise, byDate] of trendMap.entries()) {
		trend[exercise] = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
	}

	return { summary, trend };
}

export function mergeEntries(baseEntries: WorkoutEntry[], extraEntries: WorkoutEntry[]): WorkoutEntry[] {
	const merged = [...baseEntries];
	for (const entry of extraEntries) {
		const index = merged.findIndex(
			(item) => item.exercise === entry.exercise && item.date === entry.date
		);
		if (index === -1) {
			merged.push(entry);
			continue;
		}
		merged[index] = {
			...merged[index],
			parts: [...merged[index].parts, ...entry.parts],
			sets: [...merged[index].sets, ...entry.sets]
		};
	}
	return merged;
}
