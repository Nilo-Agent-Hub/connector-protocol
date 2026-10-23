// SPDX-License-Identifier: MIT
/** Provider-independent NCP runtime contracts. New Connectors should import this module. */
import type { FilePolicy } from './file-references.js';

export interface RuntimeModel {
  model: string;
  provider: string;
  providerLabel: string;
  scope: 'instance' | 'conversation';
  source: 'configuration' | 'session' | 'runtime';
}

export interface RuntimeModelChoice {
  id: string;
  model: string;
  provider: string;
  providerLabel: string;
  reasoningEfforts?: { id: string; description: string }[];
  defaultReasoningEffort?: string | null;
}

export interface RuntimeEnvironment {
  host: string;
  project: string | null;
  cwd: string;
  source: 'runtime' | 'defaults';
  sandbox: string | null;
  writableRoots: string[];
  networkAccess: boolean | null;
  approvalPolicy: string | null;
  approvalsReviewer: string | null;
}
export interface ProjectDirectory { id: string; name: string; path: string }
export interface ProjectListing {
  current: ProjectDirectory | null;
  parentId: string | null;
  directories: ProjectDirectory[];
  truncated: boolean;
}

/** Read-only observations of the repository belonging to a conversation. */
export interface RuntimeChangeEntry {
  /** Opaque within this snapshot; never a caller-provided filesystem path. */
  id: string;
  /** Repository-relative paths, subject to the existing file-read policy. */
  path: string;
  previousPath?: string;
  area: 'staged' | 'unstaged' | 'untracked' | 'working-tree';
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'conflicted' | 'typechanged';
  /** Absent or null when a reliable count is unavailable. */
  additions?: number | null;
  deletions?: number | null;
}
export interface RuntimeChanges {
  snapshotId: string;
  observedAt: string;
  /** Null for an unborn or detached HEAD when no branch name is available. */
  branch: string | null;
  entries: RuntimeChangeEntry[];
  truncated: boolean;
}
export interface RuntimeDiff {
  snapshotId: string;
  fileId: string;
  path: string;
  previousPath?: string;
  kind: 'text' | 'binary' | 'symlink' | 'submodule' | 'restricted' | 'too_large' | 'conflicted';
  /** Unified diff for text; empty for all other kinds. Maximum 256 KiB UTF-8. */
  patch: string;
  truncated: boolean;
}

export interface RuntimeUpdateInfo {
  supported: boolean;
  reason: 'disabled' | 'unsupported-platform' | 'unavailable' | null;
  status: 'idle' | 'updating' | 'restarting' | 'verifying' | 'succeeded' | 'unchanged' | 'failed' | 'uncertain';
  operationId: string | null;
  fromVersion: string | null;
  toVersion: string | null;
  error: string | null;
  updatedAt: string;
}
export function isRuntimeVersion(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 256 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.test(value);
}

export type RuntimeSettingValue = string | number | boolean | null;

/** Frozen at conversation creation; applied only when opening its native session. */
export interface RuntimeSelection {
  model?: { model: string; provider: string };
  effort?: string;
  settings?: Record<string, RuntimeSettingValue>;
}
export interface RuntimeSelectionDefaults { selection: RuntimeSelection | null; revision: number }

/** NCP 1.2: scopes in which the owner may choose a model (see SPEC "Runtime capability declarations"). */
export type RuntimeModelScope = 'draft' | 'conversation' | 'defaults';
/** NCP 1.2: one text command the runtime understands. `newTopic` commands open a fresh Hub topic. */
export interface RuntimeCommand { command: string; description: string; usage?: string; newTopic?: boolean }
export const runtimeModelScopes: readonly RuntimeModelScope[] = ['draft', 'conversation', 'defaults'];
export const RUNTIME_MAX_INPUT_LENGTH = 1_000_000;
export const RUNTIME_MAX_COMMANDS = 64;

export interface RuntimeCapabilities {
  /** Consume frozen conversation.runtimeSelection before first native input; includes opt-in NCP 1.2 messaging Connectors. */
  sessionSelection?: boolean; createSession?: boolean; inspect: boolean; switchModel: boolean; syncConnections: boolean; readFiles: boolean; reviewChanges?: boolean; reviewUncommitted?: boolean;
  reasoning?: boolean; manageProjects?: boolean; updateSettings?: boolean; manageSkills?: boolean; manageMcp?: boolean;
  initialSelection?: boolean; defaultsWhileBusy?: boolean; inputQueue?: boolean; inputSkills?: boolean;
  asyncQuestions?: boolean; steerInput?: boolean; sideConversation?: 'ephemeral' | 'inline';
  /** NCP 1.2: largest accepted user input text length in UTF-16 code units (1..1000000). */
  maxInputLength?: number;
  /** NCP 1.2: where switch-model / selection is accepted; unique entries. */
  modelScopes?: RuntimeModelScope[];
  /** NCP 1.2: text command table, at most 64 unique commands. */
  commands?: RuntimeCommand[];
  /** NCP 1.2: settings stay editable for a conversation bound to an imported native session. */
  boundSessionSettings?: boolean;
  /** Keys durably saved for the next turn, including while running. Requires gateway opt-in. */
  nextTurnSettings?: string[];
  /** Confirmed updates also affect subsequent active-turn operations; captured steps/approvals are unchanged. Gateway opt-in required. */
  liveTurnSettings?: string[];
  /** Save model and optional effort for the next turn while running/waiting. Requires switchModel and gateway opt-in. */
  nextTurnModel?: boolean;
}

/** Checks the generic NCP 1.2 capability extensions; other fields are validated by the enclosing wire boundary. */
export function genericRuntimeCapabilityExtensionsError(value: Record<string, unknown>): string | null {
  if ('maxInputLength' in value) {
    const n = value.maxInputLength;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > RUNTIME_MAX_INPUT_LENGTH) return 'maxInputLength';
  }
  if ('modelScopes' in value) {
    const scopes = value.modelScopes;
    if (!Array.isArray(scopes) || scopes.length > runtimeModelScopes.length || new Set(scopes).size !== scopes.length || scopes.some(scope => !(runtimeModelScopes as readonly unknown[]).includes(scope))) return 'modelScopes';
  }
  if ('boundSessionSettings' in value && typeof value.boundSessionSettings !== 'boolean') return 'boundSessionSettings';
  if ('nextTurnSettings' in value) {
    const keys = value.nextTurnSettings;
    if (!Array.isArray(keys) || keys.length > 64 || new Set(keys).size !== keys.length || keys.some(key => typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key))) return 'nextTurnSettings';
  }
  if ('reviewUncommitted' in value && (typeof value.reviewUncommitted !== 'boolean' || value.reviewUncommitted && value.reviewChanges !== true)) return 'reviewUncommitted';
  if ('liveTurnSettings' in value) {
    const keys = value.liveTurnSettings, next = value.nextTurnSettings;
    if (value.updateSettings !== true || !Array.isArray(next) || !Array.isArray(keys) || keys.length > 64 || new Set(keys).size !== keys.length || keys.some(key => typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) || !Array.isArray(next) || !next.includes(key))) return 'liveTurnSettings';
  }
  if ('nextTurnModel' in value && (typeof value.nextTurnModel !== 'boolean' || value.nextTurnModel && value.switchModel !== true)) return 'nextTurnModel';
  if ('commands' in value) {
    const commands = value.commands;
    if (!Array.isArray(commands) || commands.length > RUNTIME_MAX_COMMANDS) return 'commands';
    const seen = new Set<string>();
    for (const item of commands) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return 'commands';
      const { command, description, usage, newTopic, ...rest } = item as Record<string, unknown>;
      if (Object.keys(rest).length || typeof command !== 'string' || !/^\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(command) || seen.has(command.toLowerCase())) return 'commands';
      if (typeof description !== 'string' || [...description].length < 1 || [...description].length > 200) return 'commands';
      if (usage !== undefined && (typeof usage !== 'string' || [...usage].length < 1 || [...usage].length > 200)) return 'commands';
      if (newTopic !== undefined && typeof newTopic !== 'boolean') return 'commands';
      seen.add(command.toLowerCase());
    }
  }
  return null;
}

/** A nonempty patch may be deferred only when every key was explicitly advertised. */
export function supportsNextTurnSettings(capabilities: Pick<RuntimeCapabilities, 'nextTurnSettings' | 'updateSettings'> | undefined, keys: readonly string[]): boolean {
  return capabilities?.updateSettings === true && keys.length > 0 && keys.every(key => capabilities.nextTurnSettings?.includes(key));
}

/** Model writes may be deferred only when both capabilities were explicitly advertised. */
export function supportsNextTurnModel(capabilities: Pick<RuntimeCapabilities, 'nextTurnModel' | 'switchModel'> | undefined): boolean {
  return capabilities?.switchModel === true && capabilities.nextTurnModel === true;
}

/** True when `text` invokes a declared `newTopic` command: the command, optionally `@name`, then whitespace or end. */
export function startsNewTopicCommand(commands: readonly RuntimeCommand[] | undefined, text: string): boolean {
  const head = (text.trim().split(/\s/, 1)[0] ?? '').replace(/@[A-Za-z0-9_]+$/, '').toLowerCase();
  return (commands ?? []).some(item => item.newTopic === true && item.command.toLowerCase() === head);
}

export interface RuntimeReport {
  runtimeInstanceId?: string;
  settings?: { values: Record<string, RuntimeSettingValue>; allowed: Record<string, RuntimeSettingValue[]>; source: 'runtime' | 'defaults' | 'configuration' };
  runtimeUpdate?: RuntimeUpdateInfo;
  maintenance?: boolean;
  conversationId: string | null;
  runtimeVersion: string | null;
  capabilities: RuntimeCapabilities;
  reasoning?: { effort: string | null };
  environment?: RuntimeEnvironment;
  providers?: { id: string; name: string; apiMode: string; endpoint: string | null; current: boolean }[] | null;
  inventory?: { scope: 'project' | 'instance'; observedAt: string; warnings: string[] };
  model: RuntimeModel | null;
  lastUsedModel: { model: string; provider: string } | null;
  models: RuntimeModelChoice[];
  busy: boolean | null;
  usage: {
    contextTokens: number | null;
    contextLimit: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadTokens: number | null;
    contextSource: 'provider' | 'estimate' | 'unknown';
    totalsSource: 'session' | 'runtime' | 'unknown';
  };
  skills: { name: string; description: string; scope: 'installed' | 'available'; enabled?: boolean; source?: string; id?: string; mutable?: boolean }[] | null;
  mcp: { name: string; status: 'connected' | 'configured' | 'disconnected' | 'disabled' | 'connecting' | 'failed' | 'unknown'; tools: string[]; authStatus?: string; id?: string; enabled?: boolean; mutable?: boolean }[] | null;
  files: { id: string; name: string; source: string; loaded: boolean | null }[];
}

export type RuntimeRequestKind = 'input-skills' | 'inspect' | 'switch-model' | 'read-file' | 'list-changes' | 'read-diff' | 'browse-projects' | 'register-project' | 'update-settings' | 'set-skill' | 'set-mcp' | 'reload-mcp' | 'update-runtime';
export type RuntimeRequestStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'uncertain';
export interface RuntimeRequest {
  /** Server-owned file policy for review requests; never accepted from callers. */
  filePolicy?: FilePolicy;
  id: string;
  agentId: string;
  conversationId: string | null;
  kind: RuntimeRequestKind;
  payload: { compare?: 'uncommitted'; projectId?: string; choiceId?: string; fileId?: string; snapshotId?: string; effort?: string; directoryId?: string; name?: string; settings?: Record<string, RuntimeSettingValue>; targetId?: string; enabled?: boolean };
  status: RuntimeRequestStatus;
  error: string | null;
  result: { skills?: NonNullable<RuntimeReport['skills']>; file?: { name: string; text: string; truncated: boolean; source: string }; changes?: RuntimeChanges; diff?: RuntimeDiff; listing?: ProjectListing; project?: { id: string; name: string; path: string } } | null;
  createdAt: string;
  updatedAt: string;
}

/** Review requests always require a bound conversation, never instance scope. */
export type RuntimeListChangesRequest = Omit<RuntimeRequest, 'kind' | 'conversationId' | 'payload' | 'result'> & {
  filePolicy: FilePolicy;
  kind: 'list-changes';
  conversationId: string;
  payload: { compare?: 'uncommitted' };
  result: { changes: RuntimeChanges } | null;
};
export type RuntimeReadDiffRequest = Omit<RuntimeRequest, 'kind' | 'conversationId' | 'payload' | 'result'> & {
  filePolicy: FilePolicy;
  kind: 'read-diff';
  conversationId: string;
  payload: { snapshotId: string; fileId: string };
  result: { diff: RuntimeDiff } | null;
};
export type RuntimeReviewRequest = RuntimeListChangesRequest | RuntimeReadDiffRequest;

export interface RuntimeView {
  selectionDefaults?: RuntimeSelectionDefaults;
  /** Hub-admitted runtime maintenance, including unresolved update outcomes. */
  maintenance?: boolean;
  enabled: boolean;
  online: boolean;
  lastSeenAt: string | null;
  observedAt: string | null;
  report: RuntimeReport | null;
  /**
   * NCP 1.2: effective runtime capabilities served by the Hub. Reported values win; the Hub fills
   * fields according to the negotiated protocol version. Present without a report.
   */
  capabilities?: RuntimeCapabilities;
  runtimeUpdateRequest?: { id: string; clientRequestId: string; status: RuntimeRequestStatus; error?: string | null } | null;
  sync: { desiredRevision: number; appliedRevision: number | null; error: string | null };
}
