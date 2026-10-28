// SPDX-License-Identifier: MIT
/** Side questions never become Inbox messages or main-session inputs. */
export type SideMode = 'codex-ephemeral' | 'claude-btw';
export type SideExchange = { id: string; question: string; answer: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; error?: string; sequence?: number; model?: string };
export type SideConversation = { id: string; conversationId: string; mode: SideMode; status: 'open' | 'closing' | 'closed'; exchanges: SideExchange[]; model?: string; error?: string };
export type SideView = { generation: string; revision?: number; session: SideConversation | null };
export type SideCommand = { id: string; conversationId: string; parentThreadId: string; mode: SideMode; action: 'ask' | 'cancel' | 'close'; requestId: string; question?: string };
export type SideLease = { generation: string; liveIds: string[]; commands: SideCommand[]; resultSnapshots?: boolean };
export type SideResult = { generation: string; sessionId: string; requestId: string; action: SideCommand['action']; status: 'running' | 'completed' | 'failed' | 'cancelled'; answer?: string; error?: string; sequence?: number; model?: string };
