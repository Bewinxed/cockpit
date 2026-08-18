// What the slider offers comes from the model's own `supportedEffortLevels`
// and from nothing else — no list of which models have `xhigh` or `max` lives
// in this codebase, because such a list is wrong by the next model release.
// These pin that: the same five stops every time, reachability read off the
// model, and no scale drawn at all where the model has not described one.
import { expect, test } from 'bun:test';
import type { ModelInfo } from '@cockpit/core';
import { EFFORT_LEVELS, effortLabel, effortStops, hasEffortScale } from './effort-levels';

const model = (over: Partial<ModelInfo>): ModelInfo => ({
  value: 'a-model',
  displayName: 'A model',
  ...over,
});

test('the scale is the five levels, low to max, in that order', () => {
  expect(EFFORT_LEVELS.map((option) => option.value)).toEqual([
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
  ]);
});

test('a model reaching every level reaches every stop', () => {
  const stops = effortStops(
    model({
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    })
  );
  expect(stops.map((stop) => stop.reachable)).toEqual([true, true, true, true, true]);
});

test('a level the model does not name is a stop that is still drawn, out of range', () => {
  const stops = effortStops(
    model({ supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'] })
  );
  // Five stops, not three: the scale does not get shorter, `xhigh` and `max`
  // go out of range — which is the whole point of the treatment.
  expect(stops).toHaveLength(5);
  expect(stops.filter((stop) => !stop.reachable).map((stop) => stop.value)).toEqual([
    'xhigh',
    'max',
  ]);
});

test('nothing is hardcoded: a model naming only max reaches only max', () => {
  const stops = effortStops(model({ supportsEffort: true, supportedEffortLevels: ['max'] }));
  expect(stops.filter((stop) => stop.reachable).map((stop) => stop.value)).toEqual(['max']);
});

test('a model with no effort scale gets no control', () => {
  expect(hasEffortScale(model({}))).toBe(false);
  expect(hasEffortScale(null)).toBe(false);
});

test('a model that claims effort but names no levels gets no control either', () => {
  // Half an answer is not an answer: there is nothing to say where it stops.
  expect(hasEffortScale(model({ supportsEffort: true }))).toBe(false);
  expect(hasEffortScale(model({ supportsEffort: true, supportedEffortLevels: [] }))).toBe(false);
});

test('every level is described, and named by the API name', () => {
  for (const option of EFFORT_LEVELS) {
    expect(option.label).toBe(option.value);
    expect(option.description.length).toBeGreaterThan(0);
    expect(effortLabel(option.value)).toBe(option.label);
  }
});

test('high is the level the API answers on when nothing asks', () => {
  expect(EFFORT_LEVELS.filter((option) => option.apiDefault).map((option) => option.value)).toEqual([
    'high',
  ]);
});
