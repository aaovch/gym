import { getMovementBlock, type MovementBlockId } from './muscle-groups';
import { isCardioExercise } from './protocol';
import { transliterateRu } from './translit';
import type { Exercise, ExerciseKind, WorkoutDatabase } from './types';

const CARDIO_RE = /бег|кардио|элипс/i;
const JUMPS_RE = /прыж|napryzh|напрыж/i;

export function slugifyExerciseId(name: string): string {
	const base = transliterateRu(name)
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
	return base || 'exercise';
}

export function exerciseKindFromName(name: string): ExerciseKind {
	if (isCardioExercise(name) || CARDIO_RE.test(name)) return 'run';
	if (JUMPS_RE.test(name)) return 'jumps';
	return 'strength';
}

export function createExercise(name: string, id?: string): Exercise {
	const movement = getMovementBlock(name);
	const movementBlocks: MovementBlockId[] = movement ? [movement] : [];
	return {
		id: id ?? slugifyExerciseId(name),
		name,
		kind: exerciseKindFromName(name),
		movementBlocks
	};
}

export function ensureExerciseCatalog(names: string[], existing: Exercise[] = []): Exercise[] {
	const byName = new Map(existing.map((item) => [item.name, item]));
	const byId = new Map(existing.map((item) => [item.id, item]));
	const catalog: Exercise[] = [...existing];

	for (const name of names) {
		if (byName.has(name)) continue;
		let id = slugifyExerciseId(name);
		let suffix = 2;
		while (byId.has(id)) {
			id = `${slugifyExerciseId(name)}-${suffix}`;
			suffix += 1;
		}
		const exercise = createExercise(name, id);
		catalog.push(exercise);
		byName.set(name, exercise);
		byId.set(id, exercise);
	}

	return catalog.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export function exerciseById(db: WorkoutDatabase, id: string): Exercise | undefined {
	return db.exercises.find((item) => item.id === id);
}

export function exerciseByName(db: WorkoutDatabase, name: string): Exercise | undefined {
	return db.exercises.find((item) => item.name === name);
}

export function exerciseName(db: WorkoutDatabase, id: string): string {
	return exerciseById(db, id)?.name ?? id;
}

export function resolveExerciseId(db: WorkoutDatabase, name: string): string {
	return exerciseByName(db, name)?.id ?? ensureExerciseCatalog([name], db.exercises).find((e) => e.name === name)!.id;
}

export const EXERCISE_KIND_LABELS: Record<ExerciseKind, string> = {
	strength: 'Силовое',
	run: 'Кардио',
	jumps: 'Прыжки'
};

export function countLogsForExercise(db: WorkoutDatabase, exerciseId: string): number {
	return db.logs.filter((log) => log.exerciseId === exerciseId).length;
}

export function uniqueExerciseId(name: string, existing: Exercise[]): string {
	const byId = new Set(existing.map((item) => item.id));
	let id = slugifyExerciseId(name);
	let suffix = 2;
	while (byId.has(id)) {
		id = `${slugifyExerciseId(name)}-${suffix}`;
		suffix += 1;
	}
	return id;
}

export function upsertExercise(catalog: Exercise[], exercise: Exercise): Exercise[] {
	const index = catalog.findIndex((item) => item.id === exercise.id);
	const next =
		index === -1
			? [...catalog, exercise]
			: catalog.map((item) => (item.id === exercise.id ? exercise : item));
	return next.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export function removeExerciseFromCatalog(catalog: Exercise[], exerciseId: string): Exercise[] {
	return catalog.filter((item) => item.id !== exerciseId);
}

export function validateExercise(
	exercise: Exercise,
	catalog: Exercise[],
	editingId?: string
): string | null {
	const name = exercise.name.trim();
	if (!name) return 'Введите название упражнения';
	if (catalog.some((item) => item.name === name && item.id !== editingId)) {
		return 'Упражнение с таким названием уже есть';
	}
	if (!exercise.id.trim()) return 'Не удалось сформировать id';
	return null;
}
