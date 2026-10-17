// SPDX-License-Identifier: MIT
import type { CodexSelection } from './codex-settings.js';
import type { ClaudeSelection, RuntimeSelection } from './runtime.js';
import type { StickerMessageContent } from './stickers.js';
export const PROTOCOL_VERSION = 1;
export type AgentKind = "hermes" | "openclaw" | "nanobot" | "codex" | "claude" | "qoder" | "pi" | "qwenwork" | "custom";
export const isCodingAgent = (kind: AgentKind | undefined) => kind === 'codex' || kind === 'claude' || kind === 'qoder' || kind === 'pi';
export const avatarPresets = ["inbox", "codex", "claude", "qoder", "hermes", "openclaw", "nanobot", "husky", "shiba", "wolf", "rabbit", "orca", "whale", "retro-robot", "mecha", "steampunk", "eve", "sparkles", "orbit", "leaf"] as const;
export type BuiltinAvatarPreset = typeof avatarPresets[number];
/** Preset IDs are server-owned; older clients must retain IDs added later. */
export type AvatarPreset = BuiltinAvatarPreset | (string & {});
export type AvatarAppearance = 'brand' | 'icon' | 'mark' | 'preset';
export interface AvatarPresetImage {
  url: string;
  mimeType: string;
  size: number;
  version: string;
  preset?: AvatarPreset;
  appearance?: AvatarAppearance;
}
export interface AvatarProfile {
  avatar?: Attachment | null;
  avatarEmoji?: string | null;
  avatarPreset?: AvatarPreset | null;
  /** Public presentation asset, never an uploaded attachment or a write payload. */
  avatarPresetImage?: AvatarPresetImage | null;
}
export type AvatarPatch = { avatarAttachmentId: string | null } | { avatarEmoji: string | null } | { avatarPreset: AvatarPreset | null };
export interface AccountAvatarProfile extends AvatarProfile { avatarVersion: number | null }
/** Runtime machine identity with an editable display name and reported host names. */
export interface RuntimeMachine {
  id: string;
  name: string;
  /** Host names reported by connectors associated with this machine. */
  reportedNames?: string[];
  ip?: string;
  publicIp?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
export interface Agent extends AvatarProfile {
  /** Approved connector identity and capabilities; separate from the Agent brand. */
  connector?: import('./connector-protocol.js').ConnectorManifest;
  id: string;
  name: string;
  kind: AgentKind;
  /** Latest reported name of the runtime machine, when available. */
  host?: string | null;
  /** Runtime machine identity; a manually chosen binding takes priority over reports. */
  machineId?: string | null;
  /** Owner click-to-read preference, separate from connector speech grants. */
  replySpeech?: { enabled: boolean; version: number };
  /**
   * NCP 1.2: effective runtime capabilities the Hub knows without a live report (its fallback for runtimes that
   * predate the 1.2 declarations). Runtime views carry the report-merged set.
   */
  runtimeCapabilities?: Partial<import('./runtime.js').RuntimeCapabilities>;
  online: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}
export interface Conversation {
  /** Present for native history, including revoked bindings that remain read-only. */
  nativeBindingId?: string | null;
  id: string;
  agentId: string | null;
  engine?: 'pi';
  projectId?: string;
  /** Host reported project metadata for coding conversations. */
  projectName?: string;
  projectPath?: string;
  /** Frozen initial selection; apply once when opening a new native session. */
  runtimeSelection?: RuntimeSelection;
  /** Legacy initial selection; confirmed current settings come from runtime reports. */
  codexSettings?: CodexSelection;
  claudeSettings?: ClaudeSelection;
  title: string;
  /** Native runtime title, exposed only when the channel title is still the default. */
  sessionTitle?: string;
  archived: boolean;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
  lastMessage: string | null;
  unread: number;
  /** Latest agent chat/system sequence. Activity and edits do not advance it. */
  lastIncomingSeq?: number;
  /** Gateway presentation state after Hermes accepted a `/sethome` delivery. */
  isHomeChannel?: boolean;
  /** Fresh native coding turn on this topic; absent when idle or unconfirmed. */
  codingActivity?: "running" | "waiting";
}
export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  /** Remote files remain on the source agent and require a live transfer. */
  source?: "remote";
  /** Connection presence only; does not guarantee the source file still exists. */
  agentOnline?: boolean;
}
export type DeliveryStatus = "received" | "sending" | "delivered" | "failed";
export type MessageKind = "chat" | "activity" | "system";
export interface CodingInputSelection {
  mode: 'queue' | 'steer';
  skillIds: string[];
  /** Display snapshot only; native resolution always uses skillIds. */
  skillNames?: string[];
  expectedTurnId?: string;
}
export interface CodingInput extends CodingInputSelection {
  nativeAccepted?: boolean;
  state: 'queued' | 'dispatching' | 'accepted' | 'running' | 'completed' | 'interrupted' | 'failed' | 'uncertain' | 'cancelled';
  turnId?: string;
  /** Conversation sequence when the runtime picked the input up; orders it in the timeline. */
  anchorSeq?: number;
  /** The owner settled an uncertain execution; it no longer counts as backlog. */
  reviewed?: boolean;
}
export interface RuntimeActivity {
  id: string;
  category: 'skill' | 'task' | 'tool' | 'request';
  name: string;
  state: 'running' | 'retrying' | 'limited' | 'completed' | 'failed' | 'stopped' | 'unknown';
  parentId?: string;
  updatedAt: string;
  tool?: string;
  toolInput?: string;
  toolOutput?: string;
  elapsedSeconds?: number;
  attempt?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  statusCode?: number;
  runId?: string;
  toolUseId?: string;
  taskType?: 'agent' | 'shell' | 'mcp' | 'workflow' | 'unknown';
  statusText?: string;
  lastHeartbeatAt?: string;
}
/** Public process lifecycle observed by a connector; missing times stay unknown. */
export interface MessageProcess {
  id: string;
  /** Unified Agent run state. The legacy running/waiting values remain valid. */
  state: "queued" | "thinking" | "tool_calling" | "waiting_tool_result" | "responding" | "running" | "waiting" | "completed" | "failed" | "timeout" | "cancelled" | "interrupted" | "unknown";
  startedAt?: string;
  completedAt?: string;
  summary?: string;
  runId?: string;
  eventType?: import('./agent-run.js').AgentEventType;
  firstTokenAt?: string;
  endReason?: string;
  /** Native progress evidence, independent of message synchronization timestamps. */
  progress?: {
    kind: 'tool' | 'thinking' | 'note';
    summary: string;
    observedAt: string;
    /** Distinct native tool items since the observed turn start; absent for partial coverage. */
    toolCalls?: number;
  };
}
export interface Message {
  processSummary?: { count: number; detailsExpired: true; expiredAt: string };
  /** Native provider names belong to the connector; retain unfamiliar channels. */
  origin?: { provider: string; itemId: string; historical: boolean } | null;
  id: string;
  /** Durable entity revision; creation sequence remains independent. */
  revision?: number;
  conversationId: string;
  role: "user" | "agent";
  kind: MessageKind;
  label: string | null;
  text: string;
  attachments: Attachment[];
  sticker?: StickerMessageContent;
  status: DeliveryStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  seq: number;
  streaming: boolean;
  process?: MessageProcess;
  runtimeActivity?: RuntimeActivity;
  /** Optional protocol event vocabulary supplied by newer connectors. */
  runId?: string;
  eventType?: import('./agent-run.js').AgentEventType;
  agentStatus?: import('./agent-run.js').AgentRunStatus;
  tool?: { name: string; input?: string; output?: string };
  approvalId?: string;
  questionRequestId?: string;
  question?: import('./questions.js').MessageQuestion;
  questionAnswer?: import('./questions.js').MessageQuestionAnswer;
  input?: CodingInput;
}
export interface Delivery {
  id: string;
  conversation: Conversation;
  message: Message;
  history: Message[];
  questionResponse?: {
    requestId: string;
    questions: import('./questions.js').UserQuestion[];
    answers: import('./questions.js').QuestionAnswers;
  };
}
export interface Snapshot {
  agents: Agent[];
  /** Optional for compatibility with gateways predating the machine directory. */
  machines?: RuntimeMachine[];
  conversations: Conversation[];
  revision: number;
  webVersion?: string;
  cursor?: string;
}
export interface SyncChanges {
  cursor: string;
  hasMore: boolean;
  agents: Agent[];
  machines?: RuntimeMachine[];
  conversations: Conversation[];
  messages: Message[];
  removed: { agents: string[]; machines?: string[]; conversations: string[]; messages: string[] };
  invalidations: { agentIds: string[]; conversationIds: string[]; all: boolean };
  webVersion?: string;
}
export interface AccountPolicy { canCreate:boolean; allowedKinds:AgentKind[]; maxAgents:number; canChat:boolean; canConfigure:boolean; canMaintain:boolean }
export type AccessPreset = 'member' | 'builder' | 'custom';
export interface Identity extends AccountAvatarProfile {
  tenant?: AccountAvatarProfile & { id: string };
  id: string;
  name: string;
  authMode: "development" | "account";
  email: string;
  emailVerified: boolean;
  platformAdmin: boolean;
  /** Milliseconds of the last avatar change; null when the user has none. */
  avatarVersion: number | null;
  permissions: AccountPolicy;
}
export interface LoginSession {
  id: string;
  name: string;
  platform: string;
  browser: string;
  os: string;
  ip: string;
  current?: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}
export interface AdminUser extends AccountAvatarProfile {
  id: string;
  email: string;
  name: string;
  status: 'active' | 'disabled';
  admin: boolean;
  emailVerified: boolean;
  preset: AccessPreset;
  policy: AccountPolicy;
  methods: string[];
  agents: number;
  devices: number;
  lastActiveAt: string | null;
  createdAt: string;
  avatarVersion: number | null;
}
export interface AdminUserDetail {
  user: AdminUser;
  sessions: LoginSession[];
  agents: { id: string; name: string; kind: AgentKind; online: boolean; createdAt: string }[];
}
export interface Invitation {
  id: string;
  email: string | null;
  preset: AccessPreset;
  status: 'pending' | 'used' | 'expired' | 'revoked';
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedBy: string | null;
  usedByName: string | null;
  createdBy: string;
}
export interface AuditEvent {
  id: number;
  action: string;
  actorId: string | null;
  actorName: string | null;
  targetId: string | null;
  targetName: string | null;
  ip: string;
  userAgent: string;
  detail: Record<string, unknown>;
  createdAt: string;
}
export interface ApiError {
  error: string;
  message: string;
}
