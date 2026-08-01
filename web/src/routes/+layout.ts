export const prerender = true;

import { base } from '$app/paths';
import type { CyclePlan } from '$lib/cycle-plan';
import { normalizeWorkoutDatabase } from '$lib/json-store';
import { parseCyclePlan } from '$lib/storage';
import { validateTrainingThesesDoc, type TrainingThesesDoc } from '$lib/training-theses';
import {
	validateProfilesManifest,
	type ProfileBundle,
	type ProfilesManifest
} from '$lib/profiles';
import type { WorkoutDatabase } from '$lib/types';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ fetch }) => {
	const [profilesRes, thesesRes] = await Promise.all([
		fetch(`${base}/data/profiles.json`),
		fetch(`${base}/data/training-theses.json`)
	]);

	if (!profilesRes.ok) throw new Error('Не удалось загрузить список профилей');
	const profiles: ProfilesManifest = validateProfilesManifest(await profilesRes.json());

	const theses: TrainingThesesDoc = thesesRes.ok
		? validateTrainingThesesDoc(await thesesRes.json())
		: { version: 1, updatedAt: '', groups: [], matrices: [], volumeGuides: [], protocolGuides: [] };

	const profileBundles: Array<ProfileBundle<WorkoutDatabase, CyclePlan>> = await Promise.all(
		profiles.profiles.map(async (profile) => {
			const [workoutsRes, cyclePlanRes] = await Promise.all([
				fetch(`${base}/${profile.workoutsPath}`),
				fetch(`${base}/${profile.cyclePlanPath}`)
			]);
			if (!workoutsRes.ok) throw new Error(`Не удалось загрузить тренировки профиля ${profile.name}`);
			return {
				profile,
				workouts: normalizeWorkoutDatabase(await workoutsRes.json()),
				cyclePlan: cyclePlanRes.ok ? parseCyclePlan(await cyclePlanRes.text()) : null
			};
		})
	);

	return { profiles, profileBundles, theses };
};
