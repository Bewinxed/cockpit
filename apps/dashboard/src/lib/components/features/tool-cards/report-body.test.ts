import { expect, test } from 'bun:test';
import {
  isLogReport,
  reportCollapses,
  reportLineCount,
  reportPreview,
} from './report-body';

test('a short report stays expanded', () => {
  expect(reportCollapses('A short turn report.\nTwo lines only.')).toBe(false);
});

test('a report collapses once it passes the line threshold', () => {
  const lines = Array.from({ length: 16 }, (_, i) => `line ${i}`).join('\n');
  expect(reportLineCount(lines)).toBe(16);
  expect(reportCollapses(lines)).toBe(true);
});

test('a report collapses once it passes the byte threshold even in few lines', () => {
  const oneLine = 'x'.repeat(2000);
  expect(reportLineCount(oneLine)).toBe(1);
  expect(reportCollapses(oneLine)).toBe(true);
});

test('the preview keeps the first lines and caps a giant single line', () => {
  const many = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
  const preview = reportPreview(many);
  expect(preview.split('\n')).toHaveLength(15);
  expect(preview).toContain('line 0');
  expect(preview).not.toContain('line 15');

  const giant = 'y'.repeat(3000);
  const capped = reportPreview(giant);
  expect(capped.length).toBeLessThanOrEqual(1501);
});

test('a key=value dump reads as log, prose does not', () => {
  const log = ['a=1 b=2', 'x=3', 'timestamp 2026-08-16'].join('\n');
  expect(isLogReport(log)).toBe(true);

  const prose = 'I finished the port. Here is what changed:\n- item one\n- item two';
  expect(isLogReport(prose)).toBe(false);
});
