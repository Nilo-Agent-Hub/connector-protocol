// SPDX-License-Identifier: MIT
import type { Attachment } from './protocol.js';
import type { SpeechEmotion } from './speech-expression.js';
import type { ModelConnectionInput } from './runtime.js';
/** The Agent contract contains no vendor model, endpoint or credentials. */
export const speechLimits = { maxTextLength: 3000, maxConcurrent: 2, minSpeed: 0.5, maxSpeed: 2 } as const;
export interface SpeechExpression { emotion?: SpeechEmotion; style?: string }
export type SpeechFormat = 'mp3' | 'wav';
export interface SpeechRequest extends SpeechExpression {
  clientRequestId: string;
  text: string;
  voice?: string;
  speed?: number;
  format?: SpeechFormat;
}
export type SpeechInput = Required<Omit<SpeechRequest, keyof SpeechExpression>> & SpeechExpression;
export interface SpeechVoice { id: string; name: string; providerVoiceId: string }
export interface SpeechSettings {
  connectionId?: string | null;
  connectionVersion?: number;
  connectionReady?: boolean;
  migrationPending?: boolean;
  enabled: boolean;
  provider: 'minimax' | 'qwen';
  region: 'cn' | 'global';
  model: string;
  voices: SpeechVoice[];
  agentIds: string[];
  version: number;
  hasCredential: boolean;
  credentialStorageAvailable: boolean;
  defaultSpeed?: number;
  credentials?: { provider: SpeechSettings['provider']; region: SpeechSettings['region']; hasCredential: boolean }[];
}
export type SpeechSettingsInput = Omit<SpeechSettings, 'hasCredential' | 'credentialStorageAvailable' | 'credentials' | 'connectionReady' | 'migrationPending'> & { connectionDraft?: ModelConnectionInput };
export interface SpeechJob {
  id: string;
  clientRequestId: string;
  status: 'running' | 'succeeded' | 'failed' | 'uncertain';
  attachmentId: string | null;
  format: SpeechFormat;
  durationMs: number | null;
  errorCode: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface SpeechPreviewJob extends SpeechJob { attachment: Attachment | null }
export const speechToolDescription = 'Generate speech with the owner-authorized Inbox TTS service. Check action=capabilities first for voice aliases, text limit, formats and expression controls. generate needs text and a stable clientRequestId; optional voice (default), speed, emotion, style, format. Omit format for the service default. Inline cues use the portable tokens listed in capabilities (for example [[laugh]] or [[pause:0.5]]); use only supported cues/emotions. style describes the whole utterance, never a local span. get needs jobId. Poll get until terminal. Generation returns an attachmentId and does not send a message. Send the attachment separately. Never automatically create a new paid request after failed or uncertain results. Do not supply vendor models, URLs or API keys.';
export const speechToolProperties = {
  action: { type: 'string', enum: ['capabilities', 'generate', 'get'] },
  text: { type: 'string', minLength: 1, maxLength: speechLimits.maxTextLength },
  clientRequestId: { type: 'string', minLength: 1, maxLength: 128 },
  voice: { type: 'string', description: 'An alias from capabilities; omit for default.' },
  speed: { type: 'number', minimum: speechLimits.minSpeed, maximum: speechLimits.maxSpeed },
  format: { type: 'string', enum: ['mp3', 'wav'] },
  emotion: { type: 'string', description: 'Whole-utterance emotion from capabilities; omit for automatic expression.' },
  style: { type: 'string', maxLength: 500, description: 'Whole-utterance delivery instruction; only when capabilities.expression.style is true.' },
  jobId: { type: 'string', format: 'uuid' },
};
