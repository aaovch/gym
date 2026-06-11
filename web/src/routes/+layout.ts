export const prerender = true;

import { base } from '$app/paths';
import type { TrainingThesesDoc } from '$lib/training-theses';
import type { WorkoutDatabase } from '$lib/types';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ fetch }) => {
	const [workoutsRes, thesesRes] = await Promise.all([
		fetch(`${base}/data/workouts.json`),
		fetch(`${base}/data/training-theses.json`)
	]);
	const bundled: WorkoutDatabase = await workoutsRes.json();
	const theses: TrainingThesesDoc = thesesRes.ok
		? await thesesRes.json()
		: { version: 1, updatedAt: '', groups: [], matrices: [], volumeGuides: [], protocolGuides: [] };
	return { bundled, theses };
};
