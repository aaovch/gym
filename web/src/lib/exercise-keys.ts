import type { CyclePlan, MesocyclePlan } from './cycle-plan';
import { slugifyExerciseId } from './exercises';
import type { Exercise, WorkoutEntry } from './types';

export type ExerciseKeyMaps = {
	idByName: Map<string, string>;
	nameById: Map<string, string>;
	validIds: Set<string>;
};

export function buildExerciseKeyMaps(exercises: Exercise[]): ExerciseKeyMaps {
	const idByName = new Map<string, string>();
	const nameById = new Map<string, string>();
	const validIds = new Set<string>();

	for (const exercise of exercises) {
		idByName.set(exercise.name, exercise.id);
		nameById.set(exercise.id, exercise.name);
		validIds.add(exercise.id);
	}

	return { idByName, nameById, validIds };
}

export function buildExerciseKeyMapsFromEntries(entries: WorkoutEntry[]): ExerciseKeyMaps {
	const byId = new Map<string, Exercise>();
	for (const entry of entries) {
		if (!entry.exerciseId) continue;
		if (!byId.has(entry.exerciseId)) {
			byId.set(entry.exerciseId, {
				id: entry.exerciseId,
				name: entry.exercise,
				kind: 'strength',
				movementBlocks: []
			});
		}
	}
	return buildExerciseKeyMaps([...byId.values()]);
}

export function mergeExerciseKeyMaps(...maps: ExerciseKeyMaps[]): ExerciseKeyMaps {
	const idByName = new Map<string, string>();
	const nameById = new Map<string, string>();
	const validIds = new Set<string>();

	for (const map of maps) {
		for (const [name, id] of map.idByName) {
			idByName.set(name, id);
			nameById.set(id, name);
			validIds.add(id);
		}
	}

	return { idByName, nameById, validIds };
}

/** Имя упражнения → exerciseId для UI. */
export function toExerciseId(key: string, maps: ExerciseKeyMaps): string {
	if (maps.validIds.has(key)) return key;
	const byName = maps.idByName.get(key);
	if (byName) return byName;
	return slugifyExerciseId(key);
}

export function mesoAnchor(
	meso: MesocyclePlan,
	exerciseName: string,
	maps: ExerciseKeyMaps
): number | undefined {
	const id = toExerciseId(exerciseName, maps);
	return meso.anchor1rm[id];
}

export function mesoProtocolId(
	meso: MesocyclePlan,
	exerciseName: string,
	maps: ExerciseKeyMaps
): string | undefined {
	const id = toExerciseId(exerciseName, maps);
	return meso.exerciseProtocols?.[id];
}

export function isManualAnchor(
	meso: MesocyclePlan,
	exerciseName: string,
	maps: ExerciseKeyMaps
): boolean {
	const id = toExerciseId(exerciseName, maps);
	return Boolean(meso.anchor1rmManual?.[id]);
}

export function buildWorkoutKeyMaps(exercises: Exercise[], entries: WorkoutEntry[]): ExerciseKeyMaps {
	return mergeExerciseKeyMaps(buildExerciseKeyMaps(exercises), buildExerciseKeyMapsFromEntries(entries));
}
