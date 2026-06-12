import {
	best1rmBeforeDate,
	epley1rm,
	intensityPctOf1rm,
	isCardioExercise
} from './protocol';
import type { VolumeGuideRow } from './training-theses.svelte';
import type { WorkoutEntry } from './types';

export const TRAINING_VOLUME_GUIDE_ID = 'training-volume-by-intensity';

export type VolumeCheckStatus = 'ok' | 'low' | 'high';

export type VolumeCheckResult = {
	status: VolumeCheckStatus;
	totalReps: number;
	workingSets: number;
	peakPct: number;
	row: VolumeGuideRow;
	anchor1rm: number;
};

export function volumeGuideRowForPct(rows: VolumeGuideRow[], pct: number): VolumeGuideRow | null {
	for (const row of [...rows].sort((a, b) => b.fromPct - a.fromPct)) {
		if (row.toPct == null) {
			if (pct >= row.fromPct) return row;
			continue;
		}
		if (pct >= row.fromPct && pct <= row.toPct) return row;
	}
	return null;
}

function setInBand(pct: number, row: VolumeGuideRow): boolean {
	if (pct < row.fromPct) return false;
	if (row.toPct == null) return true;
	return pct <= row.toPct;
}

/** 1ПМ для проверки объёма: якорь мезо → история → null. */
export function resolveVolumeAnchor1rm(
	entries: WorkoutEntry[],
	exercise: string,
	date: string,
	mesoAnchor?: number | null,
	excludeSessionId?: string | null
): number | null {
	if (mesoAnchor && mesoAnchor > 0) return mesoAnchor;

	const prior = best1rmBeforeDate(
		entries.filter((entry) => entry.id !== excludeSessionId),
		exercise,
		date
	);
	if (prior) return prior.value;

	let sameDayBest = 0;
	for (const entry of entries) {
		if (entry.exercise !== exercise || entry.date !== date) continue;
		if (excludeSessionId && entry.id === excludeSessionId) continue;
		for (const [weight, reps] of entry.sets) {
			sameDayBest = Math.max(sameDayBest, epley1rm(weight, reps));
		}
	}
	if (sameDayBest > 0) return Math.round(sameDayBest * 10) / 10;

	return null;
}

export function anchor1rmFromSets(sets: [number, number][]): number | null {
	let best = 0;
	for (const [weight, reps] of sets) {
		best = Math.max(best, epley1rm(weight, reps));
	}
	return best > 0 ? Math.round(best * 10) / 10 : null;
}

export function evaluateSessionVolume(
	sets: [number, number][],
	anchor1rm: number,
	guideRows: VolumeGuideRow[]
): VolumeCheckResult | null {
	if (!sets.length || !anchor1rm || guideRows.length === 0) return null;

	let peakPct = 0;
	for (const [weight] of sets) {
		const pct = intensityPctOf1rm(weight, anchor1rm);
		if (pct != null && pct > peakPct) peakPct = pct;
	}

	const row = volumeGuideRowForPct(guideRows, peakPct);
	if (!row) return null;

	let totalReps = 0;
	let workingSets = 0;
	for (const [weight, reps] of sets) {
		const pct = intensityPctOf1rm(weight, anchor1rm);
		if (pct == null || !setInBand(pct, row)) continue;
		totalReps += reps;
		workingSets += 1;
	}

	let status: VolumeCheckStatus = 'ok';
	if (totalReps < row.totalRangeMin) status = 'low';
	else if (totalReps > row.totalRangeMax) status = 'high';

	return { status, totalReps, workingSets, peakPct, row, anchor1rm };
}

export function evaluateEntryVolume(
	entry: WorkoutEntry,
	anchor1rm: number | null,
	guideRows: VolumeGuideRow[]
): VolumeCheckResult | null {
	if (entry.kind !== 'strength' || isCardioExercise(entry.exercise) || !anchor1rm) return null;
	return evaluateSessionVolume(entry.sets, anchor1rm, guideRows);
}

export function volumeCheckLabel(result: VolumeCheckResult): string {
	const pct = Math.round(result.peakPct);
	const { percentLabel, totalRangeLabel, optimalTotalReps } = result.row;
	const reps = result.totalReps;

	if (result.status === 'ok') {
		return `Объём ${reps} повт. при ${pct}% (${percentLabel}) · норма ${totalRangeLabel}, опт. ${optimalTotalReps}`;
	}
	if (result.status === 'low') {
		return `Мало объёма: ${reps} повт. · норма ${totalRangeLabel} при ${pct}% (${percentLabel})`;
	}
	return `Много объёма: ${reps} повт. · норма ${totalRangeLabel} при ${pct}% (${percentLabel})`;
}
