// SPDX-License-Identifier: MIT
/** Optional channel.interactions extension; message credentials, no runtime management. */
export interface ChannelInteractionField {
  id: string;
  label: string;
  kind: 'text' | 'single-select' | 'multi-select';
  options: { id: string; label: string; value: string; description?: string }[];
  required: boolean;
  allowCustom?: boolean;
  maxLength?: number;
  maxSelections?: number;
}
export interface ChannelInteractionAction {
  id: string;
  label: string;
  intent: 'accept' | 'reject' | 'submit' | 'other';
  requiresAnswers: boolean;
}
export interface ChannelInteractionCreate {
  version: 1;
  clientRequestId: string;
  epoch: string;
  kind: 'command' | 'question';
  title: string;
  details: string;
  scope: string;
  note?: string;
  fields: ChannelInteractionField[];
  actions: ChannelInteractionAction[];
  expiresAt: string;
}
export interface ChannelInteractionResponse {
  clientRequestId: string;
  actionId: string;
  answers: Record<string, string[]>;
}
export interface ChannelInteraction extends ChannelInteractionCreate {
  id: string;
  conversationId: string;
  messageId: string;
  status: 'pending' | 'submitted' | 'resolved' | 'expired';
  createdAt: string;
  response?: ChannelInteractionResponse;
  resolution?: 'approved' | 'rejected' | 'answered' | 'skipped' | 'cancelled' | 'expired' | 'uncertain';
}
