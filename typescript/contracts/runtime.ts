// SPDX-License-Identifier: MIT
import type { CodexOptions, CodexSelection, CodexSettingsReport } from './codex-settings.js';
import type { ConnectorUpdatePlan } from './connector-update.js';
import type { ConnectorPlatform } from './connector-release.js';
import type { FilePolicy } from './file-references.js';
import type { ModelCapabilities, ModelCapabilityOverride } from './model-capabilities.js';
import type { ModelProvider, ProviderSite } from './provider-connections.js';
export type ModelApiMode = 'chat_completions' | 'responses' | 'anthropic_messages';

export interface ClaudeSettings { permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions'; effort?: 'low' | 'medium' | 'high' | 'max' }
export type ClaudeSelection = ClaudeSettings & { model?: string; provider?: string };

export interface ModelConnection {
  provider?: ModelProvider;
  site?: ProviderSite;
  references?: { speech: boolean; images: boolean; conversations: number };
  capabilities?: Record<string, ModelCapabilities>;
  searchChecks?: Record<string, import('./web-search.js').SearchCheck>;
  modelOverrides?: Record<string, ModelCapabilityOverride>;
  id: string;
  name: string;
  baseUrl: string;
  apiMode: ModelApiMode;
  models: string[];
  hasCredential: boolean;
  agentIds: string[];
  version: number;
  updatedAt: string;
}

export interface ModelConnectionInput {
  provider?: ModelProvider;
  site?: ProviderSite;
  credentialAction?: 'keep' | 'replace' | 'remove';
  modelOverrides?: Record<string, ModelCapabilityOverride>;
  name: string;
  baseUrl: string;
  apiMode: ModelApiMode;
  models: string[];
  apiKey?: string;
  agentIds: string[];
  expectedVersion?: number;
}

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
  area: 'staged' | 'unstaged' | 'untracked';
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
/** @deprecated Runtime updates are generic; use RuntimeUpdateInfo. */
export type CodexUpdateInfo = RuntimeUpdateInfo;

export type ConnectorUpdateStatus = 'idle' | 'staging' | 'restarting' | 'verifying' | 'succeeded' | 'failed' | 'uncertain';
export type ConnectorUpdateError = 'update_bridge_failed' | 'update_bridge_timeout' | 'update_bridge_reconnect_failed' | 'update_bridge_unavailable' | 'update_bridge_interrupted' | 'update_bridge_manifest_invalid';
export interface ConnectorUpdateInfo {
  supported: boolean;
  currentVersion: string | null;
  targetVersion: string | null;
  status: ConnectorUpdateStatus;
  operationId: string | null;
  error: ConnectorUpdateError | null;
  updatedAt: string;
}

export function isCodexRuntimeVersion(value: unknown): value is string {
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
/** NCP 1.2: the native settings contract a runtime speaks; absent means only generic `settings`. */
export type RuntimeNativeSettings = 'codex' | 'claude';
/** NCP 1.2: one text command the runtime understands. `newTopic` commands open a fresh Hub topic. */
export interface RuntimeCommand { command: string; description: string; usage?: string; newTopic?: boolean }
export const runtimeModelScopes: readonly RuntimeModelScope[] = ['draft', 'conversation', 'defaults'];
export const RUNTIME_MAX_INPUT_LENGTH = 1_000_000;
export const RUNTIME_MAX_COMMANDS = 64;

export interface RuntimeCapabilities {
  /** Consume frozen conversation.runtimeSelection before first native input; includes opt-in NCP 1.2 messaging Connectors. */
  sessionSelection?: boolean; createSession?: boolean; inspect: boolean; switchModel: boolean; syncConnections: boolean; readFiles: boolean; reviewChanges?: boolean;
  reasoning?: boolean; manageProjects?: boolean; updateSettings?: boolean; manageSkills?: boolean; manageMcp?: boolean;
  initialSelection?: boolean; defaultsWhileBusy?: boolean; claudeBypassPermissions?: boolean; inputQueue?: boolean; inputSkills?: boolean;
  asyncQuestions?: boolean; steerInput?: boolean; sideConversation?: 'ephemeral' | 'inline' | 'codex-ephemeral' | 'claude-btw';
  /** NCP 1.2: largest accepted user input text length in UTF-16 code units (1..1000000). */
  maxInputLength?: number;
  /** NCP 1.2: where switch-model / selection is accepted; unique entries. */
  modelScopes?: RuntimeModelScope[];
  /** NCP 1.2: native settings contract id. */
  nativeSettings?: RuntimeNativeSettings;
  /** NCP 1.2: text command table, at most 64 unique commands. */
  commands?: RuntimeCommand[];
  /** NCP 1.2: settings stay editable for a conversation bound to an imported native session. */
  boundSessionSettings?: boolean;
  /** Keys durably saved for the next turn, including while running. Requires gateway opt-in. */
  nextTurnSettings?: string[];
  /** Save model and optional effort for the next turn while running/waiting. Requires switchModel and gateway opt-in. */
  nextTurnModel?: boolean;
}

/** Returns a reason string when `value` violates the NCP 1.2 runtime capability rules, else null. */
export function runtimeCapabilityExtensionsError(value: Record<string, unknown>): string | null {
  if ('maxInputLength' in value) {
    const n = value.maxInputLength;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > RUNTIME_MAX_INPUT_LENGTH) return 'maxInputLength';
  }
  if ('modelScopes' in value) {
    const scopes = value.modelScopes;
    if (!Array.isArray(scopes) || scopes.length > runtimeModelScopes.length || new Set(scopes).size !== scopes.length || scopes.some(scope => !(runtimeModelScopes as readonly unknown[]).includes(scope))) return 'modelScopes';
  }
  if ('nativeSettings' in value && value.nativeSettings !== 'codex' && value.nativeSettings !== 'claude') return 'nativeSettings';
  if ('boundSessionSettings' in value && typeof value.boundSessionSettings !== 'boolean') return 'boundSessionSettings';
  if ('nextTurnSettings' in value) {
    const keys = value.nextTurnSettings;
    if (!Array.isArray(keys) || keys.length > 64 || new Set(keys).size !== keys.length || keys.some(key => typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key))) return 'nextTurnSettings';
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
  claude?: { settings: ClaudeSettings; source: 'configuration' | 'runtime'; conversion: 'native' | 'chat_completions' | 'responses' };
  claudeUpdate?: RuntimeUpdateInfo;
  qoderInstanceId?: string;
  piInstanceId?: string;
  claudeInstanceId?: string;
  runtimeInstanceId?: string;
  settings?: { values: Record<string, RuntimeSettingValue>; allowed: Record<string, RuntimeSettingValue[]>; source: 'runtime' | 'defaults' | 'configuration' };
  runtimeUpdate?: RuntimeUpdateInfo;
  maintenance?: boolean;
  conversationId: string | null;
  runtimeVersion: string | null;
  // Legacy wire keys remain compatible with installed hosts; see Link docs/connector-naming.md.
  bridgeVersion?: string | null;
  capabilities: RuntimeCapabilities;
  codex?: CodexSettingsReport;
  codexUpdate?: RuntimeUpdateInfo;
  bridgeUpdate?: ConnectorUpdateInfo;
  bridgeUpdateCapability?: { platform: ConnectorPlatform; safeRetry: boolean };
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

export type RuntimeRequestKind = 'input-skills' | 'inspect' | 'switch-model' | 'read-file' | 'list-changes' | 'read-diff' | 'browse-projects' | 'register-project' | 'update-settings' | 'update-claude-settings' | 'set-skill' | 'set-mcp' | 'reload-mcp' | 'update-runtime' | 'update-codex' | 'update-claude' | 'update-bridge';
export type RuntimeRequestStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'uncertain';
export interface RuntimeRequest {
  /** Server-owned file policy for review requests; never accepted from callers. */
  filePolicy?: FilePolicy;
  bridgeRelease?: ConnectorUpdatePlan;
  id: string;
  agentId: string;
  conversationId: string | null;
  kind: RuntimeRequestKind;
  payload: { projectId?: string; choiceId?: string; fileId?: string; snapshotId?: string; effort?: string; directoryId?: string; name?: string; settings?: CodexOptions & Record<string, RuntimeSettingValue>; claudeSettings?: ClaudeSettings; targetId?: string; enabled?: boolean; targetVersion?: string };
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
  payload: Record<string, never>;
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
  bridgeUpdateAllowed?: boolean;
  enabled: boolean;
  online: boolean;
  lastSeenAt: string | null;
  observedAt: string | null;
  report: RuntimeReport | null;
  /**
   * NCP 1.2: effective runtime capabilities served by the Hub. Reported values win; the Hub fills
   * fields an older runtime does not report from its server-side legacy profile. Present without a report.
   */
  capabilities?: RuntimeCapabilities;
  /** Codex-contract projection of `selectionDefaults` (read-only; the Hub stores one copy). */
  codexDefaults?: CodexSelection;
  runtimeUpdateRequest?: { id: string; clientRequestId: string; status: RuntimeRequestStatus; error?: string | null } | null;
  codexUpdateRequest?: { id: string; clientRequestId: string; status: RuntimeRequestStatus } | null;
  bridgeUpdateRequest?: { id: string; clientRequestId: string; status: RuntimeRequestStatus; error?: string | null } | null;
  sync: { desiredRevision: number; appliedRevision: number | null; error: string | null };
}

export interface ConnectionsSnapshot {
  available: boolean;
  connections: ModelConnection[];
  agents: { agentId: string; enabled: boolean; online: boolean; sync: RuntimeView['sync'] }[];
}

export const runtimeErrorMessages: Record<string, string> = {
  offline: '运行管理未连接，请检查助手连接后重试。',
  disabled: '此助手尚未启用运行管理。',
  busy: '这个话题仍在执行任务，请停止或等待完成后再切换。',
  unsupported: '当前运行时版本尚不支持这项操作。',
  unavailable: '运行时暂时无法提供这项信息。',
  changes_changed: '工作区改动已变化，请刷新列表后重新查看。',
  not_repository: '此话题的工作目录不属于 Git 仓库。',
  git_unavailable: '此主机暂时无法使用 Git。',
  review_unavailable: '当前话题暂时无法查看代码改动。',
  not_applied: '运行时未确认设置，请刷新实际状态或查看话题中的提示。',
  conflict: '远端配置已被其他方式修改，请先检查该连接。',
  invalid_config: '连接配置无法应用，请检查接口类型、地址和模型名称。',
  failed: '运行时操作失败，请检查助手后重试。',
  timeout: '未收到运行时确认，操作可能已经执行，请先刷新状态。',
  restarted: '网关已重启，未完成操作的结果不确定，请先刷新状态。',
  revoked: '运行管理授权已撤销，未完成操作的结果不确定。',
  update_failed: 'Codex 更新失败，请在主机检查安装权限与网络后重试。',
  update_timeout: 'Codex 更新超时，结果尚未确认，请在主机检查后再操作。',
  update_reconnect_failed: 'Codex 更新后的重连验证失败，请在主机检查运行状态。',
  update_unavailable: '此主机暂不支持 Codex 自更新，请在主机检查安装方式与更新配置。',
  update_interrupted: '原生运行时更新被中断，结果尚未确认，请在主机检查后再操作。',
  update_bridge_failed: 'Connector 更新失败，请在主机检查安装与服务状态。',
  update_bridge_timeout: 'Connector 更新超时，结果尚未确认，请先检查主机状态。',
  update_bridge_reconnect_failed: 'Connector 更新后的重连验证失败，请在主机检查运行状态。',
  update_bridge_unavailable: '此主机暂不支持 Connector 自更新，请先升级主机部署。',
  update_bridge_interrupted: 'Connector 更新被中断，结果尚未确认，请在主机检查后再操作。',
  update_bridge_manifest_invalid: 'Connector 更新清单无效，请刷新可用版本后重试。',
};

export function runtimeError(code: string | null | undefined): string {
  return code ? runtimeErrorMessages[code] || runtimeErrorMessages.failed : '';
}
