// SPDX-License-Identifier: MIT
/**
 * Shared Agent run/event vocabulary.
 *
 * Hermes has shipped several generations of progress payloads.  Keep the
 * compatibility inference here so the gateway adapter and the web client do
 * not have to infer a message type from the text in separate places.
 */
export const agentRunStatuses = [
  'queued', 'thinking', 'tool_calling', 'waiting_tool_result', 'responding',
  'completed', 'failed', 'timeout', 'cancelled',
] as const;
export type AgentRunStatus = typeof agentRunStatuses[number];

export const agentEventTypes = [
  'user_message', 'assistant_text', 'thinking', 'tool_call', 'tool_result',
  'context_compaction', 'system_status', 'error',
] as const;
export type AgentEventType = typeof agentEventTypes[number];

export interface HermesEventInput {
  run_id?: unknown; runId?: unknown;
  message_id?: unknown; messageId?: unknown;
  event_id?: unknown; eventId?: unknown;
  sequence?: unknown; seq?: unknown;
  timestamp?: unknown; at?: unknown;
  event_type?: unknown; eventType?: unknown; type?: unknown;
  status?: unknown;
  stream_end?: unknown; streamEnd?: unknown; final?: unknown;
  content?: unknown; text?: unknown; delta?: unknown;
  tool_name?: unknown; toolName?: unknown; tool?: unknown;
  tool_use_id?: unknown; toolUseId?: unknown;
  tool_input?: unknown; toolInput?: unknown;
  tool_output?: unknown; toolOutput?: unknown; result?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

export interface NormalizedAgentEvent {
  runId: string;
  messageId?: string;
  eventId?: string;
  sequence?: number;
  timestamp: string;
  eventType: AgentEventType;
  rawEventType?: string;
  status: AgentRunStatus;
  content: string;
  tool?: { name: string; input?: string; output?: string; duration?: number };
  toolUseId?: string;
  error?: string;
  streamEnd: boolean;
}

export interface AgentTimelineMessage {
  runId: string;
  messageId: string;
  sequence?: number;
  timestamp: string;
  type: AgentEventType;
  status: AgentRunStatus;
  content: string;
  tool?: NormalizedAgentEvent['tool'];
  toolUseId?: string;
  error?: string;
  rawEventType?: string;
}

export interface AgentRunSnapshot {
  runId: string;
  status: AgentRunStatus;
  terminal: boolean;
  messages: AgentTimelineMessage[];
  firstTokenAt?: string;
  startedAt?: string;
  completedAt?: string;
  diagnostics: {
    duplicateEvents: number;
    staleEvents: number;
    statusTransitionFailures: number;
    unknownEvents: string[];
    missingFields: string[];
    parseErrors: number;
  };
}

const terminalStatuses = new Set<AgentRunStatus>(['completed', 'failed', 'timeout', 'cancelled']);
const activeStatuses = new Set<AgentRunStatus>(['queued', 'thinking', 'tool_calling', 'waiting_tool_result', 'responding']);
const eventAliases: Record<string, AgentEventType> = {
  user: 'user_message', user_message: 'user_message', request: 'user_message',
  assistant: 'assistant_text', assistant_text: 'assistant_text', text: 'assistant_text',
  message: 'assistant_text', delta: 'assistant_text', token: 'assistant_text', assistant_delta: 'assistant_text', text_delta: 'assistant_text', message_delta: 'assistant_text',
  thinking: 'thinking', thought: 'thinking', planning: 'thinking', plan: 'thinking', reasoning: 'thinking', thinking_delta: 'thinking', thought_delta: 'thinking',
  tool: 'tool_call', tool_call: 'tool_call', tool_use: 'tool_call', tool_start: 'tool_call', tool_started: 'tool_call', tool_progress: 'tool_call', tool_generating: 'tool_call', tool_output_risk: 'tool_call',
  tool_result: 'tool_result', tool_output: 'tool_result', tool_end: 'tool_result', tool_finished: 'tool_result', tool_complete: 'tool_result', tool_completed: 'tool_result', tool_failed: 'tool_result', tool_error: 'tool_result',
  context_compaction: 'context_compaction', context_compaction_start: 'context_compaction', context_compaction_complete: 'context_compaction', context_compaction_failed: 'context_compaction',
  compaction: 'context_compaction', compacting: 'context_compaction', compaction_start: 'context_compaction', compaction_complete: 'context_compaction', compaction_failed: 'context_compaction',
  status: 'system_status', status_update: 'system_status', system: 'system_status', system_message: 'system_status', system_status: 'system_status', notice: 'system_status', lifecycle: 'system_status', connected: 'system_status', gateway_ready: 'system_status', gateway_restart: 'system_status', gateway_restarting: 'system_status', gateway_restarted: 'system_status', gateway_error: 'system_status', gateway_start_timeout: 'system_status', gateway_protocol_error: 'system_status',
  reconnect: 'system_status', reconnected: 'system_status', disconnected: 'system_status', run_started: 'system_status', run_start: 'system_status', run_queued: 'system_status', run_cancelled: 'error', run_stopped: 'error', run_failed: 'error', assistant_start: 'system_status', message_start: 'system_status', approval_request: 'system_status', approval_result: 'system_status', approval_expired: 'system_status', clarify: 'system_status', clarification_request: 'system_status', clarify_request: 'system_status', sudo_request: 'system_status', secret_request: 'system_status', background_process: 'system_status', background_task: 'system_status', background_complete: 'system_status', review_summary: 'system_status', heartbeat: 'system_status', reaction: 'system_status', skin_changed: 'system_status', secret_expire: 'system_status', sudo_expire: 'system_status',
  session_info: 'system_status', session_title: 'system_status', session_reset: 'system_status', session_resumed: 'system_status', session_branched: 'system_status', title_set: 'system_status', resume: 'system_status', branch: 'system_status', reset: 'system_status', goal: 'system_status', goal_set: 'system_status', goal_paused: 'system_status', goal_resumed: 'system_status', goal_cleared: 'system_status', model_switched: 'system_status', config_updated: 'system_status', mcp_reload: 'system_status', skills_reload: 'system_status', cron_failure: 'system_status', checkpoint: 'system_status', checkpoint_restored: 'system_status', rollback: 'system_status', undo: 'system_status', retry: 'system_status', update: 'system_status',
  reasoning_delta: 'thinking', reasoning_available: 'thinking', moa_reference: 'thinking', moa_aggregating: 'thinking', subagent_thinking: 'thinking', subagent_text: 'assistant_text', subagent_start: 'tool_call', subagent_spawn_requested: 'tool_call', subagent_tool: 'tool_call', subagent_progress: 'tool_call', subagent_complete: 'tool_result', subagent_failed: 'tool_result', message_complete: 'assistant_text',
  error: 'error', failed: 'error', timeout: 'error', cancelled: 'error', canceled: 'error',
  final: 'assistant_text', completed: 'assistant_text', done: 'assistant_text',
  stream_end: 'assistant_text', stream_finished: 'assistant_text', response_complete: 'assistant_text', response_completed: 'assistant_text', run_completed: 'assistant_text', run_complete: 'assistant_text', turn_completed: 'assistant_text', response_finished: 'assistant_text', finish: 'assistant_text',
};

const textAliases = {
  runId: ['run_id', 'runId'], messageId: ['message_id', 'messageId'], eventId: ['event_id', 'eventId'],
  sequence: ['sequence', 'seq'], timestamp: ['timestamp', 'at'], eventType: ['event_type', 'eventType', 'event', 'event_name', 'eventName', 'type'],
  toolName: ['tool_name', 'toolName', 'tool'], toolInput: ['tool_input', 'toolInput'],
  toolOutput: ['tool_output', 'toolOutput', 'result'],
} as const;

function firstValue(input: HermesEventInput, keys: readonly string[]): unknown {
  for (const key of keys) if (input[key] !== undefined && input[key] !== null) return input[key];
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try { return JSON.stringify(value); } catch { return String(value); }
}

function stringValue(value: unknown): string | undefined {
  const valueText = text(value).trim();
  return valueText || undefined;
}

function numberValue(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function durationValue(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function boolValue(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function normalizeEventType(value: unknown): { type?: AgentEventType; raw?: string } {
  const raw = stringValue(value)?.trim().replace(/(?<=[a-z0-9])(?=[A-Z])/g, '_').toLowerCase().replace(/[\s./-]+/g, '_');
  if (!raw) return {};
  return { type: eventAliases[raw], raw };
}

function normalizeStatus(value: unknown): AgentRunStatus | undefined {
  const raw = stringValue(value)?.trim().replace(/(?<=[a-z0-9])(?=[A-Z])/g, '_').toLowerCase().replace(/[\s.-]+/g, '_');
  if (!raw) return;
  if (agentRunStatuses.includes(raw as AgentRunStatus)) return raw as AgentRunStatus;
  if (['start', 'starting', 'started', 'created', 'accepted'].includes(raw)) return 'queued';
  if (raw === 'running' || raw === 'in_progress' || raw === 'inprogress') return 'responding';
  if (raw === 'waiting' || raw === 'awaiting_tool' || raw === 'tool_waiting') return 'waiting_tool_result';
  if (raw === 'success' || raw === 'succeeded' || raw === 'done' || raw === 'complete') return 'completed';
  if (raw === 'cancelled' || raw === 'canceled' || raw === 'stopped') return 'cancelled';
  return;
}

function compatibilityType(content: string, metadata: HermesEventInput): AgentEventType | undefined {
  const plain = content.trim();
  const kind = stringValue(metadata.agent_inbox_kind)?.toLowerCase();
  const label = stringValue(metadata.agent_inbox_label)?.toLowerCase();
  if (kind === 'chat') return 'assistant_text';
  if (kind === 'system' || metadata._interim_send === true || metadata.non_conversational === true) return 'system_status';
  if (label?.includes('thinking') || label?.includes('思考') || /^💬\s*\S/u.test(plain)) return 'thinking';
  if (label?.includes('tool') || label?.includes('工具') || /^(?:⚙️|🐍|📖|📄|📝|🔍|🔎|🔧|💻)/u.test(plain)) return 'tool_call';
  if (/^⚠️|^No pending command/u.test(plain)) return 'system_status';
  return;
}

function inferStatus(type: AgentEventType, explicit: AgentRunStatus | undefined, streamEnd: boolean, metadata: HermesEventInput): AgentRunStatus {
  if (type === 'context_compaction' && explicit === 'completed') return 'thinking';
  if (explicit) return explicit;
  if (type === 'user_message') return 'queued';
  if (type === 'thinking') return 'thinking';
  if (type === 'tool_call') return 'tool_calling';
  if (type === 'tool_result') return stringValue(metadata.error) ? 'failed' : 'responding';
  if (type === 'context_compaction') {
    const raw = stringValue(firstValue(metadata, ['event_type', 'eventType', 'type']))?.toLowerCase() || '';
    // Compaction completion is local progress, not completion of the run.
    if (raw.includes('fail')) return 'failed';
    return explicit === 'timeout' || explicit === 'cancelled' || explicit === 'failed' ? explicit : 'thinking';
  }
  if (type === 'error') {
    const raw = stringValue(firstValue(metadata, ['event_type', 'eventType', 'type']))?.toLowerCase();
    return raw?.includes('timeout') ? 'timeout' : raw?.includes('cancel') ? 'cancelled' : 'failed';
  }
  if (type === 'assistant_text' && streamEnd) return 'completed';
  return type === 'assistant_text' ? 'responding' : 'thinking';
}

/** Redacts common credential fields and bounds diagnostic payloads. */
export function redactDiagnostic(value: unknown, limit = 1200): string {
  const secret = /(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|cookie|private[_-]?key)/i;
  const scrub = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.slice(0, 32).map(scrub);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item as Record<string, unknown>).slice(0, 64).map(([key, v]) => [key, secret.test(key) ? '[REDACTED]' : scrub(v)]));
    return typeof item === 'string' && secret.test(item) ? '[REDACTED]' : item;
  };
  let result: string;
  try { result = typeof value === 'string' ? value : JSON.stringify(scrub(value)); } catch { result = '[unserializable]'; }
  // Also scrub already-serialized JSON strings (the event envelope commonly
  // carries tool input as a JSON string rather than an object).
  result = result.replace(/("(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|cookie|private[_-]?key)"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"');
  return result.length <= limit ? result : `${result.slice(0, limit)}…`;
}

export function normalizeHermesEvent(raw: unknown, fallbackRunId = 'legacy'): NormalizedAgentEvent {
  const input = (raw && typeof raw === 'object' ? raw : {}) as HermesEventInput;
  const messageId = stringValue(firstValue(input, textAliases.messageId));
  const eventId = stringValue(firstValue(input, textAliases.eventId));
  const runId = stringValue(firstValue(input, textAliases.runId)) || (messageId ? `legacy:${messageId}` : eventId ? `legacy:${eventId}` : fallbackRunId);
  const sequence = numberValue(firstValue(input, textAliases.sequence));
  const timestamp = stringValue(firstValue(input, textAliases.timestamp)) || new Date().toISOString();
  const explicit = normalizeEventType(firstValue(input, textAliases.eventType));
  const content = text(firstValue(input, ['content', 'text', 'delta', 'rendered', 'payload']));
  // Legacy Hermes callbacks may carry only a text fragment and a stream
  // marker. Treat that shape as assistant text; an explicitly unknown type is
  // still a diagnosable system event and must never enter the reply body.
  const eventType = explicit.type || (explicit.raw ? 'system_status' : compatibilityType(content, input) || (content ? 'assistant_text' : 'system_status'));
  const streamEnd = boolValue(firstValue(input, ['stream_end', 'streamEnd', 'final'])) || ['final', 'completed', 'done', 'response_complete', 'response_completed', 'stream_end', 'stream_finished', 'run_completed', 'run_complete', 'turn_completed', 'response_finished', 'message_complete', 'assistant_end', 'finish'].includes(explicit.raw || '');
  const toolName = stringValue(firstValue(input, textAliases.toolName));
  const toolUseId = stringValue(firstValue(input, ['tool_use_id', 'toolUseId']));
  const toolInput = firstValue(input, textAliases.toolInput);
  const toolOutput = firstValue(input, textAliases.toolOutput);
  const duration = durationValue(firstValue(input, ['tool_duration', 'toolDuration', 'duration', 'duration_seconds', 'elapsed_seconds', 'elapsedSeconds']));
  const tool = toolName ? { name: toolName, ...(toolInput !== undefined ? { input: redactDiagnostic(toolInput) } : {}), ...(toolOutput !== undefined ? { output: redactDiagnostic(toolOutput) } : {}), ...(duration !== undefined ? { duration } : {}) } : undefined;
  const error = stringValue(input.error);
  return { runId, messageId, eventId, sequence, timestamp, eventType, rawEventType: explicit.raw, status: inferStatus(eventType, normalizeStatus(input.status), streamEnd, input), content: eventType === 'assistant_text' || eventType === 'user_message' ? content : redactDiagnostic(content), tool, toolUseId, ...(error ? { error: redactDiagnostic(error) } : {}), streamEnd };
}

function eventKey(event: NormalizedAgentEvent): string {
  const run = event.runId || 'legacy';
  if (event.eventId) return `${run}:event:${event.eventId}`;
  if (event.messageId && event.sequence !== undefined) return `${run}:message:${event.messageId}:${event.sequence}`;
  if (event.messageId) return `${run}:message:${event.messageId}:${event.eventType}:${event.content}`;
  return `${run}:${event.sequence ?? ''}:${event.eventType}:${event.content}`;
}

function runStatus(event: NormalizedAgentEvent): AgentRunStatus {
  if (event.eventType === 'tool_result' && terminalStatuses.has(event.status)) return 'responding';
  if (event.eventType === 'context_compaction' && terminalStatuses.has(event.status)) return 'thinking';
  return event.status;
}

function terminal(status: AgentRunStatus): boolean { return terminalStatuses.has(status); }

/** Idempotent, sequence-aware reducer used by replay and reconnect paths. */
export class AgentRunReducer {
  private readonly seen = new Set<string>();
  private readonly events: AgentTimelineMessage[] = [];
  private lastSequence = -1;
  private snapshotValue: AgentRunSnapshot;

  constructor(public readonly runId: string) {
    this.snapshotValue = { runId, status: 'queued', terminal: false, messages: this.events, diagnostics: { duplicateEvents: 0, staleEvents: 0, statusTransitionFailures: 0, unknownEvents: [], missingFields: [], parseErrors: 0 } };
  }

  ingest(raw: unknown): AgentRunSnapshot {
    let event: NormalizedAgentEvent;
    try { event = normalizeHermesEvent(raw, this.runId); } catch { this.snapshotValue.diagnostics.parseErrors++; return this.snapshot(); }
    const key = eventKey(event);
    if (this.seen.has(key)) { this.snapshotValue.diagnostics.duplicateEvents++; return this.snapshot(); }
    this.seen.add(key);
    const effectiveStatus = runStatus(event);
    const staleSequence = event.sequence !== undefined && event.sequence < this.lastSequence;
    if (!event.eventId && event.sequence === undefined) this.snapshotValue.diagnostics.missingFields.push('event_id/sequence');
    if (event.rawEventType && !eventAliases[event.rawEventType]) this.snapshotValue.diagnostics.unknownEvents.push(event.rawEventType);
    if (staleSequence) this.snapshotValue.diagnostics.staleEvents++;
    if (event.sequence !== undefined) this.lastSequence = Math.max(this.lastSequence, event.sequence);
    // Once a run has reached a terminal state, an active or competing delayed
    // event is diagnostic data only. Do not append it to the replay timeline
    // where it could look like a second response or revive a loading record.
    if (this.snapshotValue.terminal && (effectiveStatus !== this.snapshotValue.status || activeStatuses.has(effectiveStatus))) {
      this.snapshotValue.diagnostics.staleEvents++;
      this.snapshotValue.diagnostics.statusTransitionFailures++;
      return this.snapshot();
    }
    if (!this.snapshotValue.startedAt) this.snapshotValue.startedAt = event.timestamp;
    if (event.eventType === 'assistant_text' && event.content && !this.snapshotValue.firstTokenAt) this.snapshotValue.firstTokenAt = event.timestamp;

    const message: AgentTimelineMessage = { runId: event.runId, messageId: event.messageId || key, sequence: event.sequence, timestamp: event.timestamp, type: event.eventType, status: event.status, content: event.content, tool: event.tool, toolUseId: event.toolUseId, error: event.error, rawEventType: event.rawEventType };
    const prior = event.messageId && this.events.find(item => item.messageId === event.messageId && item.type === 'assistant_text');
    if (prior && event.eventType === 'assistant_text' && staleSequence) return this.snapshot();
    if (prior && event.eventType === 'assistant_text' && event.content && !staleSequence) {
      prior.content = event.content.startsWith(prior.content) ? event.content : prior.content.startsWith(event.content) ? prior.content : prior.content + event.content;
      prior.status = event.status; prior.timestamp = event.timestamp; prior.sequence = event.sequence ?? prior.sequence;
    } else this.events.push(message);
    this.events.sort((a, b) => (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER));

    if (this.snapshotValue.terminal) {
      if (effectiveStatus !== this.snapshotValue.status || activeStatuses.has(effectiveStatus)) {
        this.snapshotValue.diagnostics.staleEvents++;
        this.snapshotValue.diagnostics.statusTransitionFailures++;
      }
    } else {
      const invalidQueuedTransition = !staleSequence && effectiveStatus === 'queued' && activeStatuses.has(this.snapshotValue.status);
      if (invalidQueuedTransition) {
        this.snapshotValue.diagnostics.statusTransitionFailures++;
      }
      if (!staleSequence && !invalidQueuedTransition) this.snapshotValue.status = effectiveStatus;
    }
    if (!staleSequence && terminal(effectiveStatus) && !this.snapshotValue.terminal) {
      this.snapshotValue.terminal = true;
      this.snapshotValue.completedAt ||= event.timestamp;
    }
    return this.snapshot();
  }

  snapshot(): AgentRunSnapshot { return { ...this.snapshotValue, messages: this.events.map(item => ({ ...item, tool: item.tool && { ...item.tool } }),), diagnostics: { ...this.snapshotValue.diagnostics, unknownEvents: [...this.snapshotValue.diagnostics.unknownEvents], missingFields: [...this.snapshotValue.diagnostics.missingFields] } }; }
}

export function agentStatusLabel(status: AgentRunStatus): string {
  return ({ queued: '排队中', thinking: '思考中', tool_calling: '正在调用工具', waiting_tool_result: '等待工具结果', responding: '回复中', completed: '回复完成', failed: '执行失败', timeout: '已超时', cancelled: '已取消' } as Record<string, string>)[status] || '';
}
