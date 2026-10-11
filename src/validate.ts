import type { Scenario, Session } from './domain.js';

type RecordValue = Record<string, unknown>;
const DAY_MS = 86_400_000;
const isRecord = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isNumber = (value: unknown, minimum: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum;
const isInteger = (value: unknown, minimum: number): value is number =>
  isNumber(value, minimum) && Number.isSafeInteger(value);

/** Round-trip the calendar date; JS otherwise silently normalizes February 30. */
function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isText);
}

function unknownFields(value: RecordValue, allowed: string[], label: string, errors: string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${label}: unknown field "${key}".`);
  }
}

function uniqueStrings(value: unknown, label: string, errors: string[]): void {
  if (!stringArray(value)) errors.push(`${label} must be an array of non-empty strings.`);
  else if (new Set(value).size !== value.length) errors.push(`${label} must not contain duplicates.`);
}

/** Validate structure, not feasibility: an impossible valid week can ask a question. */
export function validateScenario(input: unknown): Scenario {
  const errors: string[] = [];
  if (!isRecord(input)) throw new Error('Scenario must be an object.');
  unknownFields(input, ['id', 'title', 'request', 'asOf', 'weekStart', 'weekEnd', 'availableMinutes',
    'availableEquipment', 'maxWeeklyMinutes', 'minDaysBetweenHardSessions', 'maxSessionsPerDay', 'sessions'], 'Scenario', errors);
  for (const key of ['id', 'title', 'request']) if (!isText(input[key])) errors.push(`${key} must be a non-empty string.`);
  for (const key of ['asOf', 'weekStart', 'weekEnd']) if (!isDate(input[key])) errors.push(`${key} must be a valid YYYY-MM-DD calendar date.`);
  if (isDate(input.weekStart) && isDate(input.weekEnd) && input.weekStart > input.weekEnd) errors.push('weekStart must not follow weekEnd.');
  if (isDate(input.asOf) && isDate(input.weekStart) && isDate(input.weekEnd) &&
      (input.asOf < input.weekStart || input.asOf > input.weekEnd)) errors.push('asOf must be inside the week.');
  if (!isNumber(input.maxWeeklyMinutes, 0)) errors.push('maxWeeklyMinutes must be a finite non-negative number.');
  if (!isInteger(input.minDaysBetweenHardSessions, 0)) errors.push('minDaysBetweenHardSessions must be a non-negative integer.');
  if (!isInteger(input.maxSessionsPerDay, 1)) errors.push('maxSessionsPerDay must be a positive integer.');
  uniqueStrings(input.availableEquipment, 'availableEquipment', errors);
  if (!isRecord(input.availableMinutes)) errors.push('availableMinutes must be an object mapping dates to minutes.');
  else for (const [date, minutes] of Object.entries(input.availableMinutes)) {
    if (!isDate(date)) errors.push(`availableMinutes key "${date}" must be a valid YYYY-MM-DD calendar date.`);
    else if (isDate(input.weekStart) && isDate(input.weekEnd) && (date < input.weekStart || date > input.weekEnd)) errors.push(`availableMinutes date ${date} is outside the week.`);
    if (!isNumber(minutes, 0)) errors.push(`availableMinutes[${date}] must be a finite non-negative number.`);
  }
  const ids = new Set<string>();
  if (!Array.isArray(input.sessions)) errors.push('sessions must be an array.');
  else input.sessions.forEach((value: unknown, index: number) => {
    const label = `sessions[${index}]`;
    if (!isRecord(value)) { errors.push(`${label} must be an object.`); return; }
    unknownFields(value, ['id', 'title', 'date', 'durationMinutes', 'intensity', 'equipment', 'status', 'locked', 'priority'], label, errors);
    for (const key of ['id', 'title']) if (!isText(value[key])) errors.push(`${label}.${key} must be a non-empty string.`);
    if (isText(value.id)) {
      if (ids.has(value.id)) errors.push(`Duplicate session ID "${value.id}".`);
      ids.add(value.id);
    }
    if (!isDate(value.date)) errors.push(`${label}.date must be a valid YYYY-MM-DD calendar date.`);
    else {
      if (isDate(input.weekStart) && isDate(input.weekEnd) && (value.date < input.weekStart || value.date > input.weekEnd)) errors.push(`${label}.date is outside the week.`);
      if (isDate(input.asOf) && (value.status === 'completed' || value.status === 'missed') && value.date > input.asOf) errors.push(`${label}: ${value.status} session cannot be in the future.`);
    }
    if (!isNumber(value.durationMinutes, Number.MIN_VALUE)) errors.push(`${label}.durationMinutes must be a finite positive number.`);
    if (value.intensity !== 'easy' && value.intensity !== 'hard') errors.push(`${label}.intensity must be easy or hard.`);
    uniqueStrings(value.equipment, `${label}.equipment`, errors);
    if (value.status !== 'completed' && value.status !== 'missed' && value.status !== 'planned') errors.push(`${label}.status must be completed, missed, or planned.`);
    if (typeof value.locked !== 'boolean') errors.push(`${label}.locked must be boolean.`);
    if (value.priority !== 'required' && value.priority !== 'optional') errors.push(`${label}.priority must be required or optional.`);
    if (value.status === 'missed' && value.locked === true) errors.push(`${label}: a missed session cannot be locked.`);
  });
  if (errors.length) throw new Error(`Invalid scenario:\n${errors.join('\n')}`);
  return input as unknown as Scenario;
}

/** Exact gate failures. No model can override these violations. */
export function validateProposal(scenario: Scenario, proposal: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(proposal)) return ['Proposal must be an object.'];
  unknownFields(proposal, ['status', 'summary', 'decisions', 'questions'], 'Proposal', errors);
  if (proposal.status !== 'ready' && proposal.status !== 'needs_clarification') errors.push('Proposal status must be ready or needs_clarification.');
  if (!isText(proposal.summary)) errors.push('Proposal summary must be a non-empty string.');
  if (!stringArray(proposal.questions)) errors.push('Proposal questions must be an array of non-empty strings.');
  else {
    if (proposal.status === 'ready' && proposal.questions.length) errors.push('A ready proposal must have no questions.');
    if (proposal.status === 'needs_clarification' && !proposal.questions.some(question =>
      question.trim().length >= 12 && /\?\s*$/.test(question) &&
      !/^(can you (clarify|help)|please clarify|what do you mean)\??$/i.test(question.trim()))) {
      errors.push('A clarification proposal must include a specific question.');
    }
  }
  const clarification = proposal.status === 'needs_clarification';
  if (proposal.decisions === undefined && clarification) return errors;
  if (!Array.isArray(proposal.decisions)) return [...errors, 'Proposal decisions must be an array.'];

  const originals = new Map(scenario.sessions.map(session => [session.id, session]));
  const seen = new Set<string>();
  const scheduled: { session: Session; date: string }[] = [];
  proposal.decisions.forEach((value: unknown, index: number) => {
    const label = `decisions[${index}]`;
    if (!isRecord(value)) { errors.push(`${label} must be an object.`); return; }
    unknownFields(value, ['sessionId', 'action', 'date', 'reason'], label, errors);
    if (!isText(value.sessionId)) errors.push(`${label}.sessionId must be a non-empty string.`);
    if (value.action !== 'keep' && value.action !== 'move' && value.action !== 'drop') errors.push(`${label}.action must be keep, move, or drop.`);
    if (value.date !== null && !isDate(value.date)) errors.push(`${label}.date must be a valid YYYY-MM-DD calendar date or null.`);
    if (!isText(value.reason)) errors.push(`${label}.reason must be a non-empty string.`);
    if (!isText(value.sessionId)) return;
    if (seen.has(value.sessionId)) errors.push(`Duplicate decision for session "${value.sessionId}".`);
    seen.add(value.sessionId);
    const session = originals.get(value.sessionId);
    if (!session) { errors.push(`Unknown session ID "${value.sessionId}".`); return; }
    if ((session.status === 'completed' || session.locked) && (value.action !== 'keep' || value.date !== session.date)) errors.push(`Session "${session.id}" is completed or locked and must stay unchanged.`);
    if (value.action === 'drop') {
      if (value.date !== null) errors.push(`Dropped session "${session.id}" must have a null date.`);
      if (session.priority === 'required') errors.push(`Required session "${session.id}" cannot be dropped.`);
      return;
    }
    if (value.action !== 'keep' && value.action !== 'move') return;
    if (!isDate(value.date)) { errors.push(`Scheduled session "${session.id}" must have a date.`); return; }
    if (value.action === 'keep' && value.date !== session.date) errors.push(`Kept session "${session.id}" must retain its original date.`);
    if (value.action === 'move' && value.date === session.date) errors.push(`Moved session "${session.id}" must change its date.`);
    if (session.status === 'missed' && value.action === 'keep') errors.push(`Missed session "${session.id}" cannot be kept; move it or drop it if optional.`);
    if (value.date < scenario.weekStart || value.date > scenario.weekEnd) errors.push(`Session "${session.id}" is scheduled outside the week.`);
    if (session.status !== 'completed' && value.date < scenario.asOf) errors.push(`Session "${session.id}" cannot be scheduled before asOf.`);
    scheduled.push({ session, date: value.date });
  });
  if (!clarification) for (const session of scenario.sessions) {
    if (!seen.has(session.id)) errors.push(`Missing decision for session "${session.id}".`);
  }
  // Incomplete clarification decisions are diagnostic only; never an executable plan.
  if (clarification) return errors;
  const byDay = new Map<string, typeof scheduled>();
  for (const item of scheduled) {
    const entries = byDay.get(item.date) ?? [];
    entries.push(item);
    byDay.set(item.date, entries);
    if (item.session.status !== 'completed') for (const equipment of item.session.equipment) {
      if (!scenario.availableEquipment.includes(equipment)) errors.push(`Session "${item.session.id}" requires unavailable equipment "${equipment}".`);
    }
  }
  for (const [date, entries] of byDay) {
    const futureMinutes = entries.filter(item => item.session.status !== 'completed')
      .reduce((sum, item) => sum + item.session.durationMinutes, 0);
    const available = Object.hasOwn(scenario.availableMinutes, date) ? scenario.availableMinutes[date] : 0;
    if (futureMinutes > available) errors.push(`Daily capacity exceeded on ${date}: ${futureMinutes} minutes scheduled, ${available} available.`);
    if (entries.length > scenario.maxSessionsPerDay) errors.push(`Session limit exceeded on ${date}: ${entries.length} sessions, maximum ${scenario.maxSessionsPerDay}.`);
  }
  const weeklyMinutes = scheduled.reduce((sum, item) => sum + item.session.durationMinutes, 0);
  if (weeklyMinutes > scenario.maxWeeklyMinutes) errors.push(`Weekly capacity exceeded: ${weeklyMinutes} minutes including completed sessions, maximum ${scenario.maxWeeklyMinutes}.`);
  const hard = scheduled.filter(item => item.session.intensity === 'hard').sort((a, b) => a.date.localeCompare(b.date));
  for (let index = 1; index < hard.length; index++) {
    const previous = hard[index - 1];
    const current = hard[index];
    const distance = (Date.parse(`${current.date}T00:00:00Z`) - Date.parse(`${previous.date}T00:00:00Z`)) / DAY_MS;
    if (distance < scenario.minDaysBetweenHardSessions) errors.push(`Hard sessions "${previous.session.id}" and "${current.session.id}" are ${distance} days apart; minimum ${scenario.minDaysBetweenHardSessions}.`);
  }
  return errors;
}
