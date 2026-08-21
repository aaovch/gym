export type ExerciseMoveDirection = -1 | 1;

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
