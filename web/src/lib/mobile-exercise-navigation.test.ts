import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adjacentExercise,
  allPlannedSetsFailed,
  horizontalSwipeDirection
} from './mobile-exercise-navigation';

test('adjacentExercise moves freely between exercises without wrapping', () => {
  const exercises = ['Присед', 'Жим', 'Тяга'];

  assert.equal(adjacentExercise(exercises, 'Присед', 1), 'Жим');
  assert.equal(adjacentExercise(exercises, 'Тяга', -1), 'Жим');
  assert.equal(adjacentExercise(exercises, 'Присед', -1), null);
  assert.equal(adjacentExercise(exercises, 'Тяга', 1), null);
});

test('horizontalSwipeDirection accepts deliberate horizontal swipes only', () => {
  assert.equal(horizontalSwipeDirection(250, 100, 150, 108), 1);
  assert.equal(horizontalSwipeDirection(100, 100, 180, 92), -1);
  assert.equal(horizontalSwipeDirection(100, 100, 140, 100), 0);
  assert.equal(horizontalSwipeDirection(100, 100, 170, 190), 0);
});

test('allPlannedSetsFailed requires every planned set to be recorded as failed', () => {
  assert.equal(allPlannedSetsFailed(5, 5, [0, 1, 2, 3, 4]), true);
  assert.equal(allPlannedSetsFailed(5, 4, [0, 1, 2, 3]), false);
  assert.equal(allPlannedSetsFailed(5, 5, [0, 1, 3, 4]), false);
  assert.equal(allPlannedSetsFailed(0, 0, []), false);
});
