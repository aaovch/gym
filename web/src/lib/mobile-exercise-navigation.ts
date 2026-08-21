export type ExerciseMoveDirection = -1 | 1;

export const MOBILE_EXERCISE_HOLD_MS = 500;

export function adjacentExercise(
  exercises: string[],
  currentExercise: string | null,
  direction: ExerciseMoveDirection
): string | null {
  if (!exercises.length) return null;
  const currentIndex = currentExercise ? exercises.indexOf(currentExercise) : -1;
  if (currentIndex < 0) return exercises[0] ?? null;
  return exercises[currentIndex + direction] ?? null;
}

export function horizontalSwipeDirection(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  minDistance = 56
): ExerciseMoveDirection | 0 {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  if (Math.abs(deltaX) < minDistance || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return 0;
  return deltaX < 0 ? 1 : -1;
}

export function holdPointerMoved(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  tolerance = 12
): boolean {
  return Math.hypot(currentX - startX, currentY - startY) > tolerance;
}

export function allPlannedSetsFailed(
  plannedSetCount: number,
  recordedSetCount: number,
  failedSets: number[]
): boolean {
  if (plannedSetCount <= 0 || recordedSetCount < plannedSetCount) return false;
  const failed = new Set(failedSets);
  return Array.from({ length: plannedSetCount }, (_, index) => index).every((index) => failed.has(index));
}
