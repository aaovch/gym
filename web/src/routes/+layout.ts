export const prerender = true;

import { base } from '$app/paths';
import type { CyclePlan } from '$lib/cycle-plan';
import { normalizeWorkoutDatabase } from '$lib/json-store';
import { parseCyclePlan } from '$lib/storage';
import { validateTrainingThesesDoc, type TrainingThesesDoc } from '$lib/training-theses';
import type { WorkoutDatabase } from '$lib/types';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ fetch }) => {
	const [workoutsRes, thesesRes, cyclePlanRes] = await Promise.all([
		fetch(`${base}/data/workouts.json`),
		fetch(`${base}/data/training-theses.json`),
		fetch(`${base}/data/cycle-plan.json`)
	]);

	const bundled: WorkoutDatabase = normalizeWorkoutDatabase(
		await workoutsRes.json()
	);

	const theses: TrainingThesesDoc = thesesRes.ok
		? validateTrainingThesesDoc(await thesesRes.json())
		: { version: 1, updatedAt: '', groups: [], matrices: [], volumeGuides: [], protocolGuides: [] };

	let bundledCyclePlan: CyclePlan | null = null;
	if (cyclePlanRes.ok) {
		bundledCyclePlan = parseCyclePlan(await cyclePlanRes.text());
	}

	return { bundled, theses, bundledCyclePlan };
};
