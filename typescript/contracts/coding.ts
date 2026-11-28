// SPDX-License-Identifier: MIT
/** Generic coding-session wire types shared by every coding Agent. */
export interface CodingProject { id: string; name: string; path?: string; host?: string; hidden?: boolean }
export type CodingSessionState = 'idle' | 'running' | 'waiting' | 'interrupted' | 'failed' | 'unknown';
export interface TurnRuntime {
  model: string | null;
  effort: string | null;
  settings: Record<string, string | boolean>;
}
/** Classified reason of a failed turn; unknown reasons read as unclassified. */
export interface SessionFailure {
  reason: 'quota' | (string & {});
  /** RFC 3339; null when the runtime did not say. */
  resetsAt?: string | null;
  /** Short display label of the allowance, at most 60 characters. */
  scope?: string | null;
}
export interface CodingSession {
  /** Only with `state: 'failed'`. */
  failure?: SessionFailure | null;
  /** Native values for the current or most recent turn. */
  turnRuntime?: TurnRuntime | null;
  inputMessageIds?: string[];
  inputUncertain?: boolean;
  /** Optional user-visible title reported by the native runtime thread. */
  sessionTitle?: string | null;
  conversationId: string;
  projectId: string;
  threadId: string | null;
  turnId: string | null;
  state: CodingSessionState;
  model: string | null;
  error: string | null;
  environment?: RuntimeEnvironment;
}
export type CodingQuestion = import('./questions.js').UserQuestion;
export type CodingApprovalResolution = 'approved' | 'rejected' | 'timed-out' | 'cancelled';
export interface CodingApproval {
  /** Nonblocking questions remain answerable across turns of the same thread. */
  blocking?: boolean;
  source?: 'rpc' | 'agent-message';
  /** Gateway-negotiated original message client key; only for async agent messages. */
  sourceMessageKey?: string;
  scope?: 'once' | 'turn';
  id: string; conversationId: string; threadId: string; turnId: string;
  kind: 'command' | 'file-change' | 'permissions' | 'user-input';
  title: string; details: string; choices: { id: string; label: string }[];
  questions: CodingQuestion[];
  status: 'pending' | 'submitted' | 'resolved' | 'expired';
  createdAt: string;
}
export interface CodingAction {
  id: string; conversationId: string; instanceId: string;
  kind: 'interrupt' | 'approval';
  payload: { turnId?: string; approvalId?: string; decision?: string; answers?: Record<string, string[]> };
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'uncertain';
  error: string | null;
}
export type CodingQueuePauseReason = 'interrupted' | 'failed' | 'uncertain' | 'unknown' | 'disabled' | 'quota';
export interface CodingInputQueue {
  paused: boolean;
  /** Present while paused; only messages queued before the pause are held. */
  reason?: CodingQueuePauseReason;
  pausedAt?: string;
  messages: import('./protocol.js').Message[];
  /** Waiting inputs, excluding uncertain executions. */
  waiting?: number;
  /** Queued inputs held behind the pause boundary. */
  held?: number;
  heldIds?: string[];
  /** Owner-scheduled automatic resume while paused for quota (RFC 3339). */
  resumeAt?: string | null;
}
export interface CodingView {
  inputCapabilities?: { queue: boolean; skills: boolean; steer?: boolean };
  inputQueue?: CodingInputQueue;
  enabled: boolean; online: boolean; version: string | null;
  account: 'apiKey' | 'chatgpt' | 'external' | 'missing' | 'unknown';
  projects: CodingProject[];
  /** Project selected for newly created conversations. */
  defaultProjectId?: string | null;
  session: CodingSession | null; environment?: RuntimeEnvironment; approvals: CodingApproval[];
}
import type { RuntimeEnvironment } from './runtime.js';
