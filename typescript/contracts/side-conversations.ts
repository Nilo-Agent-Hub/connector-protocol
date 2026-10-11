// SPDX-License-Identifier: MIT
/** Side questions never become Inbox messages or main-session inputs. */
export type SideMode = 'codex-ephemeral' | 'claude-btw';
export type SideExchange = { id: string; question: string; answer: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; error?: string };
export type SideConversation = { id: string; conversationId: string; mode: SideMode; status: 'open' | 'closing' | 'closed'; exchanges: SideExchange[]; error?: string };
export type SideView = { generation: string; session: SideConversation | null };
export type SideCommand = { id: string; conversationId: string; parentThreadId: string; mode: SideMode; action: 'ask' | 'cancel' | 'close'; requestId: string; question?: string };
export type SideLease = { generation: string; liveIds: string[]; commands: SideCommand[] };
export type SideResult = { generation: string; sessionId: string; requestId: string; action: SideCommand['action']; status: 'completed' | 'failed' | 'cancelled'; answer?: string; error?: string };
