// SPDX-License-Identifier: MIT
/** Explicit compatibility contracts for installed clients and native settings adapters. */
import type * as Core from './runtime-core.js';
import { genericRuntimeCapabilityExtensionsError, isRuntimeVersion } from './runtime-core.js';
import type { CodexOptions, CodexSelection, CodexSettingsReport } from './codex-settings.js';
import type { ConnectorUpdatePlan } from './connector-update.js';
import type { ConnectorPlatform } from './connector-release.js';
import type { FilePolicy } from './file-references.js';
import type { ModelCapabilities, ModelCapabilityOverride } from './model-capabilities.js';
import type { ModelProvider, ProviderSite } from './provider-connections.js';
import type { RuntimeChanges, RuntimeDiff, RuntimeSettingValue, RuntimeUpdateInfo } from './runtime-core.js';

export interface ClaudeSettings { permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions'; effort?: 'low' | 'medium' | 'high' | 'max' }
export type ClaudeSelection = ClaudeSettings & { model?: string; provider?: string };

export type ModelApiMode = 'chat_completions' | 'responses' | 'anthropic_messages';

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

/** @deprecated Runtime updates are generic; use RuntimeUpdateInfo. */
export type CodexUpdateInfo = RuntimeUpdateInfo;
/** @deprecated Use isRuntimeVersion from runtime-core. */
export const isCodexRuntimeVersion = isRuntimeVersion;

/** Native adapter contracts, not Connector identity or arbitrary configuration namespaces. */
export type RuntimeNativeSettings = 'codex' | 'claude';
export interface RuntimeCapabilities extends Omit<Core.RuntimeCapabilities, 'sideConversation'> {
  claudeBypassPermissions?: boolean;
  nativeSettings?: RuntimeNativeSettings;
  sideConversation?: Core.RuntimeCapabilities['sideConversation'] | 'codex-ephemeral' | 'claude-btw';
}

/** Compatibility boundary: native contract ids remain closed while generic fields use shared rules. */
export function runtimeCapabilityExtensionsError(value: Record<string, unknown>): string | null {
  if ('nativeSettings' in value && value.nativeSettings !== 'codex' && value.nativeSettings !== 'claude') return 'nativeSettings';
  return genericRuntimeCapabilityExtensionsError(value);
}

export interface RuntimeReport extends Omit<Core.RuntimeReport, 'capabilities'> {
  capabilities: RuntimeCapabilities;
  claude?: { settings: ClaudeSettings; source: 'configuration' | 'runtime'; conversion: 'native' | 'chat_completions' | 'responses' };
  claudeUpdate?: RuntimeUpdateInfo;
  qoderInstanceId?: string;
  piInstanceId?: string;
  claudeInstanceId?: string;
  bridgeVersion?: string | null;
  codex?: CodexSettingsReport;
  codexUpdate?: RuntimeUpdateInfo;
  bridgeUpdate?: ConnectorUpdateInfo;
  bridgeUpdateCapability?: { platform: ConnectorPlatform; safeRetry: boolean };
}

export type RuntimeRequestKind = Core.RuntimeRequestKind | 'update-claude-settings' | 'update-codex' | 'update-claude' | 'update-bridge';
export interface RuntimeRequest extends Omit<Core.RuntimeRequest, 'kind' | 'payload'> {
  bridgeRelease?: ConnectorUpdatePlan;
  kind: RuntimeRequestKind;
  payload: Omit<Core.RuntimeRequest['payload'], 'settings'> & {
    settings?: CodexOptions & Record<string, RuntimeSettingValue>;
    claudeSettings?: ClaudeSettings;
    targetVersion?: string;
  };
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

export interface RuntimeView extends Omit<Core.RuntimeView, 'report' | 'capabilities'> {
  report: RuntimeReport | null;
  capabilities?: RuntimeCapabilities;
  bridgeUpdateAllowed?: boolean;
  /** Read-only native projection; selectionDefaults remains the stored source. */
  codexDefaults?: CodexSelection;
  codexUpdateRequest?: { id: string; clientRequestId: string; status: Core.RuntimeRequestStatus } | null;
  bridgeUpdateRequest?: { id: string; clientRequestId: string; status: Core.RuntimeRequestStatus; error?: string | null } | null;
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
