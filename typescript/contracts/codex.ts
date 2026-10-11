// SPDX-License-Identifier: MIT
export interface CodexProject { id: string; name: string; path?: string; host?: string; hidden?: boolean }
export type CodexSessionState = 'idle' | 'running' | 'waiting' | 'interrupted' | 'failed' | 'unknown';
export interface CodexSession {
  inputMessageIds?: string[];
  inputUncertain?: boolean;
  /** Optional user-visible title reported by the native runtime thread. */
  sessionTitle?: string | null;
  conversationId: string;
  projectId: string;
  threadId: string | null;
  turnId: string | null;
  state: CodexSessionState;
  model: string | null;
  error: string | null;
  environment?: RuntimeEnvironment;
}
export type CodexQuestion = import('./questions.js').UserQuestion;
export type CodexApprovalResolution = 'approved' | 'rejected' | 'timed-out' | 'cancelled';
export interface CodexApproval {
  /** Nonblocking questions remain answerable across turns of the same thread. */
  blocking?: boolean;
  source?: 'rpc' | 'agent-message';
  scope?: 'once' | 'turn';
  id: string; conversationId: string; threadId: string; turnId: string;
  kind: 'command' | 'file-change' | 'permissions' | 'user-input';
  title: string; details: string; choices: { id: string; label: string }[];
  questions: CodexQuestion[];
  status: 'pending' | 'submitted' | 'resolved' | 'expired';
  createdAt: string;
}
export interface CodexAction {
  id: string; conversationId: string; instanceId: string;
  kind: 'interrupt' | 'approval';
  payload: { turnId?: string; approvalId?: string; decision?: string; answers?: Record<string, string[]> };
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'uncertain';
  error: string | null;
}
export type CodingQueuePauseReason = 'interrupted' | 'failed' | 'uncertain' | 'unknown' | 'disabled';
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
}
export interface CodexView {
  inputCapabilities?: { queue: boolean; skills: boolean };
  inputQueue?: CodingInputQueue;
  enabled: boolean; online: boolean; version: string | null;
  account: 'apiKey' | 'chatgpt' | 'external' | 'missing' | 'unknown';
  projects: CodexProject[];
  /** Project selected for newly created conversations. */
  defaultProjectId?: string | null;
  session: CodexSession | null; environment?: RuntimeEnvironment; approvals: CodexApproval[];
}
import type { RuntimeEnvironment } from './runtime.js';
