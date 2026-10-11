import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from '../src/report.js';
import type { WorkflowResult } from '../src/domain.js';

const result: WorkflowResult = {
  scenario: { id: 'test', title: '<script>alert(1)</script>', request: 'Need a smaller week', asOf: '2026-10-14', weekStart: '2026-10-12', weekEnd: '2026-10-18', availableMinutes: {}, availableEquipment: [], maxWeeklyMinutes: 100, minDaysBetweenHardSessions: 2, maxSessionsPerDay: 1, sessions: [] },
  status: 'needs_clarification', proposal: { status: 'needs_clarification', summary: 'Cannot fit required work.', decisions: [], questions: ['Can you add a day?'] }, review: null,
  trace: [{ stage: 'planner', attempt: 1, durationMs: 10, output: { text: '</pre><script>alert(2)</script>' } }],
  startedAt: '2026-10-11T00:00:00Z', elapsedMs: 10, provider: 'test-double'
};
test('escapes input and model content in report', () => {
  const html = renderReport(result);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('</pre><script>'));
});
test('clarification report cannot appear approved', () => {
  const html = renderReport(result);
  assert.ok(html.includes('Answer needed'));
  assert.ok(html.includes('Can you add a day?'));
  assert.ok(!html.includes('Plan approved'));
});
test('invalid scenario still produces a blocked diagnostic report', () => {
  const bad = { ...result, scenario: { ...result.scenario, sessions: null } } as unknown as WorkflowResult;
  const html = renderReport(bad);
  assert.ok(html.includes('Input rejected'));
  assert.ok(html.includes('No plan was approved'));
  assert.ok(!html.includes('Plan approved'));
});
test('malformed blocked replay evidence yields diagnostics instead of a render crash', () => {
  const bad = { ...result, status: 'blocked', proposal: { ...result.proposal, decisions: 'bad' } } as unknown as WorkflowResult;
  const html = renderReport(bad);
  assert.ok(html.includes('Input rejected'));
  assert.ok(html.includes('No plan was approved'));
});
