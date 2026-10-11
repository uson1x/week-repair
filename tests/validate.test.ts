import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Proposal, Scenario } from '../src/domain.js';
import { validateProposal, validateScenario } from '../src/validate.js';

const fixture = (name: string): Scenario => validateScenario(JSON.parse(
  readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8')));
const clone = <T>(value: T): T => structuredClone(value);
function repaired(scenario: Scenario): Proposal {
  return {
    status: 'ready', summary: 'Preserve completed work and fit the remaining required sessions.', questions: [],
    decisions: scenario.sessions.map(session => ({
      sessionId: session.id,
      action: session.status === 'missed' ? 'move' : session.priority === 'optional' ? 'drop' : 'keep',
      date: session.status === 'missed' ? scenario.asOf : session.priority === 'optional' ? null : session.date,
      reason: session.status === 'completed' ? 'Preserve completed history.' : 'Respect capacity and required sessions.',
    })),
  };
}
const has = (errors: string[], text: string): void => assert.ok(errors.some(error => error.includes(text)), JSON.stringify(errors));

test('synthetic fixtures validate; disruption and equipment plans pass', () => {
  for (const name of ['disrupted-week', 'equipment-restriction']) {
    const scenario = fixture(name);
    assert.deepEqual(validateProposal(scenario, repaired(scenario)), []);
  }
  assert.equal(fixture('impossible-required').sessions.length, 2);
});

test('input boundary: reject bad shapes, numeric limits, duplicates and contradictions', () => {
  assert.throws(() => validateScenario(null), /must be an object/);
  for (const change of [
    { maxWeeklyMinutes: NaN }, { maxWeeklyMinutes: -1 }, { minDaysBetweenHardSessions: 0.5 },
    { maxSessionsPerDay: 0 }, { availableMinutes: [] }, { availableEquipment: ['mat', 'mat'] },
    { asOf: '2026-10-12' }, { weekEnd: '2026-10-04' }, { request: '' },
  ]) assert.throws(() => validateScenario({ ...fixture('disrupted-week'), ...change }));
  const scenario = fixture('disrupted-week');
  scenario.sessions[1].id = scenario.sessions[0].id;
  assert.throws(() => validateScenario(scenario), /Duplicate session ID/);
  scenario.sessions[1].id = 'restored';
  scenario.sessions[1].locked = true;
  assert.throws(() => validateScenario(scenario), /missed session cannot be locked/);
  scenario.sessions[1].locked = false;
  scenario.sessions[0].date = '2026-10-09';
  assert.throws(() => validateScenario(scenario), /completed session cannot be in the future/);
});

test('calendar round-trip rejects normalized and timezone dates', () => {
  for (const date of ['2026-02-30', '2026-10-8', '2026-10-08T00:00:00Z', '2026-13-01']) {
    assert.throws(() => validateScenario({ ...fixture('disrupted-week'), asOf: date }), /calendar date/);
    const scenario = fixture('disrupted-week');
    const proposal = repaired(scenario);
    proposal.decisions[1].date = date;
    has(validateProposal(scenario, proposal), 'calendar date');
  }
});

test('ready requires original ID coverage and rejects invented or duplicated sessions', () => {
  const scenario = fixture('disrupted-week');
  const proposal = repaired(scenario);
  proposal.decisions.pop();
  has(validateProposal(scenario, proposal), 'Missing decision');
  proposal.decisions.push({ ...proposal.decisions[1], sessionId: 'invented' });
  has(validateProposal(scenario, proposal), 'Unknown session ID');
  proposal.decisions.push(clone(proposal.decisions[1]));
  has(validateProposal(scenario, proposal), 'Duplicate decision');
});

test('preserve completed/locked work and prohibit required drops', () => {
  const scenario = fixture('disrupted-week');
  const proposal = repaired(scenario);
  proposal.decisions[0] = { ...proposal.decisions[0], action: 'move', date: '2026-10-06' };
  has(validateProposal(scenario, proposal), 'must stay unchanged');
  proposal.decisions[1] = { ...proposal.decisions[1], action: 'drop', date: null };
  has(validateProposal(scenario, proposal), 'cannot be dropped');
  scenario.sessions[2].locked = true;
  proposal.decisions[2] = { ...proposal.decisions[2], action: 'move', date: '2026-10-11' };
  has(validateProposal(scenario, proposal), '"friday-easy" is completed or locked');
});

test('missed sessions cannot be kept, scheduled in the past or outside the week', () => {
  const scenario = fixture('disrupted-week');
  const proposal = repaired(scenario);
  proposal.decisions[1] = { ...proposal.decisions[1], action: 'keep', date: '2026-10-07' };
  has(validateProposal(scenario, proposal), 'Missed session');
  has(validateProposal(scenario, proposal), 'before asOf');
  proposal.decisions[1] = { ...proposal.decisions[1], action: 'move', date: '2026-10-12' };
  has(validateProposal(scenario, proposal), 'outside the week');
});

test('action/date shape, reasons and immutable prescriptions are checked', () => {
  const scenario = fixture('disrupted-week');
  const proposal = repaired(scenario);
  proposal.decisions[2].date = null;
  has(validateProposal(scenario, proposal), 'must have a date');
  proposal.decisions[4].date = '2026-10-11';
  has(validateProposal(scenario, proposal), 'must have a null date');
  proposal.decisions[0].date = '2026-10-06';
  has(validateProposal(scenario, proposal), 'retain its original date');
  proposal.decisions[1].date = '2026-10-07';
  has(validateProposal(scenario, proposal), 'must change its date');
  proposal.decisions[1].reason = '';
  has(validateProposal(scenario, proposal), 'reason must be');
  has(validateProposal(scenario, { ...repaired(scenario), durationMinutes: 5 }), 'unknown field');
  has(validateProposal(scenario, { ...repaired(scenario), decisions: [{ ...repaired(scenario).decisions[0], intensity: 'easy' }] }), 'unknown field');
});

test('full-week total counts completed work while history ignores current equipment and availability', () => {
  const scenario = fixture('equipment-restriction');
  const proposal = repaired(scenario);
  assert.deepEqual(validateProposal(scenario, proposal), []);
  scenario.maxWeeklyMinutes = 114;
  has(validateProposal(scenario, proposal), '115 minutes including completed sessions');
  scenario.maxWeeklyMinutes = 115;
  assert.deepEqual(validateProposal(scenario, proposal), []);
});

test('hard-session spacing includes completed history and uses UTC calendar distance', () => {
  const scenario = fixture('disrupted-week');
  const proposal = repaired(scenario);
  scenario.minDaysBetweenHardSessions = 3;
  has(validateProposal(scenario, proposal), 'are 2 days apart');
  scenario.minDaysBetweenHardSessions = 2;
  assert.deepEqual(validateProposal(scenario, proposal), []);
  scenario.sessions[3].priority = 'optional';
  proposal.decisions[3] = { ...proposal.decisions[3], action: 'drop', date: null };
  scenario.minDaysBetweenHardSessions = 4;
  has(validateProposal(scenario, proposal), 'are 3 days apart');
});

test('enforce aggregate daily minutes, missing day capacity, and per-day count', () => {
  const scenario = fixture('disrupted-week');
  const proposal = repaired(scenario);
  proposal.decisions[2] = { ...proposal.decisions[2], action: 'move', date: scenario.asOf };
  has(validateProposal(scenario, proposal), '65 minutes scheduled, 45 available');
  has(validateProposal(scenario, proposal), '2 sessions, maximum 1');
  scenario.availableMinutes[scenario.asOf] = 65;
  scenario.maxSessionsPerDay = 2;
  assert.deepEqual(validateProposal(scenario, proposal), []);
  delete scenario.availableMinutes[scenario.asOf];
  has(validateProposal(scenario, proposal), '0 available');
});

test('future unavailable equipment cannot be silently substituted', () => {
  const scenario = fixture('equipment-restriction');
  const proposal = repaired(scenario);
  proposal.decisions[2] = { ...proposal.decisions[2], action: 'move', date: scenario.asOf };
  has(validateProposal(scenario, proposal), 'requires unavailable equipment "barbell"');
});

test('impossible required week requests clarification; incomplete clarification cannot become ready', () => {
  const scenario = fixture('impossible-required');
  const question = 'Can either required run move to next week, since Sunday only allows one 30-minute session?';
  assert.deepEqual(validateProposal(scenario, { status: 'needs_clarification', summary: 'Both required runs cannot fit.', questions: [question] }), []);
  assert.deepEqual(validateProposal(scenario, { status: 'needs_clarification', summary: 'Both required runs cannot fit.', decisions: [], questions: [question] }), []);
  has(validateProposal(scenario, { status: 'needs_clarification', summary: 'Blocked.', questions: ['Can you clarify?'] }), 'specific question');
  has(validateProposal(scenario, { status: 'needs_clarification', summary: 'Blocked.', questions: [] }), 'specific question');
  has(validateProposal(scenario, { status: 'ready', summary: 'Done.', decisions: [], questions: [question] }), 'must have no questions');
  has(validateProposal(scenario, repaired(scenario)), 'Session limit exceeded');
  has(validateProposal(scenario, repaired(scenario)), 'Daily capacity exceeded');
  has(validateProposal(scenario, { status: 'needs_clarification', summary: 'Blocked.', questions: [question], decisions: [{ sessionId: 'unknown', action: 'keep', date: scenario.asOf, reason: 'Unknown.' }] }), 'Unknown session ID');
});

test('malformed proposal shapes return violations without throwing', () => {
  const scenario = fixture('disrupted-week');
  for (const proposal of [null, [], {}, { status: 'ready', summary: 'Done.', questions: [], decisions: [null] }]) {
    assert.ok(validateProposal(scenario, proposal).length > 0);
  }
});
