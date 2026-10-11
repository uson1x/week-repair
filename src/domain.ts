/** Synthetic planning data. Exercise prescriptions are immutable. */
export interface Session {
  id: string;
  title: string;
  date: string;
  durationMinutes: number;
  intensity: 'easy' | 'hard';
  equipment: string[];
  status: 'completed' | 'missed' | 'planned';
  locked: boolean;
  priority: 'required' | 'optional';
}

export interface Scenario {
  id: string;
  title: string;
  request: string;
  asOf: string;
  weekStart: string;
  weekEnd: string;
  availableMinutes: Record<string, number>;
  availableEquipment: string[];
  maxWeeklyMinutes: number;
  minDaysBetweenHardSessions: number;
  maxSessionsPerDay: number;
  sessions: Session[];
}

export interface Decision {
  sessionId: string;
  action: 'keep' | 'move' | 'drop';
  date: string | null;
  reason: string;
}

export interface Proposal {
  status: 'ready' | 'needs_clarification';
  summary: string;
  decisions: Decision[];
  questions: string[];
}

export interface Review {
  approved: boolean;
  issues: string[];
  strengths: string[];
}

export interface TraceEvent {
  stage: string;
  attempt: number;
  durationMs: number;
  input?: unknown;
  output?: unknown;
  errors?: string[];
}

export interface Provider {
  identity?: string;
  generate<T>(role: 'planner' | 'reviewer', system: string, payload: unknown, schema: object): Promise<T>;
}

export interface WorkflowResult {
  scenario: Scenario;
  status: 'approved' | 'needs_clarification' | 'blocked';
  proposal: Proposal | null;
  review: Review | null;
  trace: TraceEvent[];
  startedAt: string;
  elapsedMs: number;
  provider: string;
}
