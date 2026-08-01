export type ProfileDefinition = {
	id: string;
	name: string;
	initials: string;
	urlSlug: string;
	workoutsPath: string;
	cyclePlanPath: string;
};

export type ProfilesManifest = {
	version: 1;
	defaultProfileId: string;
	profiles: ProfileDefinition[];
};

export type ProfileBundle<TWorkoutDatabase, TCyclePlan> = {
	profile: ProfileDefinition;
	workouts: TWorkoutDatabase;
	cyclePlan: TCyclePlan | null;
};

export const DEFAULT_PROFILE_ID = 'alexander';

export const DEFAULT_PROFILE: ProfileDefinition = {
	id: DEFAULT_PROFILE_ID,
	name: 'Александр',
	initials: 'А',
	urlSlug: 'alexander',
	workoutsPath: 'data/workouts.json',
	cyclePlanPath: 'data/cycle-plan.json'
};

function isObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSafeDataPath(value: unknown, fileName: string): value is string {
	if (typeof value !== 'string') return false;
	const expectedName = value === `data/${fileName}` || value.endsWith(`/${fileName}`);
	return value.startsWith('data/') && expectedName && !value.includes('..') && !value.includes('\\');
}

export function validateProfilesManifest(raw: unknown): ProfilesManifest {
	if (!isObject(raw) || raw.version !== 1 || !Array.isArray(raw.profiles)) {
		throw new Error('profiles.json: ожидается manifest version 1');
	}
	if (raw.profiles.length === 0) throw new Error('profiles.json: нужен хотя бы один профиль');

	const ids = new Set<string>();
	const urlSlugs = new Set<string>();
	const profiles = raw.profiles.map((item, index): ProfileDefinition => {
		if (!isObject(item)) throw new Error(`profiles.json: profiles[${index}] должен быть объектом`);
		const { id, name, initials, urlSlug, workoutsPath, cyclePlanPath } = item;
		if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id) || ids.has(id)) {
			throw new Error(`profiles.json: некорректный или повторный id profiles[${index}]`);
		}
		if (typeof name !== 'string' || !name.trim()) {
			throw new Error(`profiles.json: имя profiles[${index}] обязательно`);
		}
		if (typeof initials !== 'string' || !initials.trim()) {
			throw new Error(`profiles.json: initials profiles[${index}] обязательны`);
		}
		if (typeof urlSlug !== 'string' || !/^[a-z0-9-]+$/.test(urlSlug) || urlSlugs.has(urlSlug)) {
			throw new Error(`profiles.json: некорректный или повторный urlSlug profiles[${index}]`);
		}
		if (!isSafeDataPath(workoutsPath, 'workouts.json')) {
			throw new Error(`profiles.json: небезопасный workoutsPath profiles[${index}]`);
		}
		if (!isSafeDataPath(cyclePlanPath, 'cycle-plan.json')) {
			throw new Error(`profiles.json: небезопасный cyclePlanPath profiles[${index}]`);
		}
		ids.add(id);
		urlSlugs.add(urlSlug);
		return { id, name, initials, urlSlug, workoutsPath, cyclePlanPath };
	});

	if (typeof raw.defaultProfileId !== 'string' || !ids.has(raw.defaultProfileId)) {
		throw new Error('profiles.json: defaultProfileId должен ссылаться на существующий профиль');
	}

	return {
		version: 1,
		defaultProfileId: raw.defaultProfileId,
		profiles
	};
}
