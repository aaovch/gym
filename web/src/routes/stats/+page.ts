import { base } from '$app/paths';
import type { WorkoutData } from '$lib/types';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const res = await fetch(`${base}/data/workouts.json`);
	const data: WorkoutData = await res.json();
	return { data };
};
