export const prerender = true;

import { base } from '$app/paths';
import type { WorkoutDatabase } from '$lib/types';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ fetch }) => {
	const res = await fetch(`${base}/data/workouts.json`);
	const bundled: WorkoutDatabase = await res.json();
	return { bundled };
};
