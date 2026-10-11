// SPDX-License-Identifier: MIT
import { qwenSpeechVoices } from './qwen-speech-voices.js';
import { speechCues, speechEmotions, type SpeechExpressionCapabilities } from './speech-expression.js';
import type { SpeechSettings, SpeechFormat } from './speech-generation.js';
/** MiniMax's public speech console catalog, checked 2026-10-01.
 * There is no TTS model-discovery endpoint. Voice discovery uses /v1/get_voice.
 * Keep provider-specific controls here, separate from the neutral Agent API.
 */
export const speechCatalog = {
  minimax: {
    name: 'MiniMax',
    dynamicVoices: true,
    sites: [{ id: 'cn', name: '中国大陆 API', host: 'api.minimaxi.com' }, { id: 'global', name: '国际 API', host: 'api.minimax.io' }],
    models: [
      { id: 'speech-2.8-hd', name: 'Speech 2.8 HD', description: '旗舰音质' },
      { id: 'speech-2.8-turbo', name: 'Speech 2.8 Turbo', description: '低延迟' },
      { id: 'speech-2.6-hd', name: 'Speech 2.6 HD', description: '音质与韵律' },
      { id: 'speech-2.6-turbo', name: 'Speech 2.6 Turbo', description: '快速生成' },
      { id: 'speech-02-hd', name: 'Speech 02 HD', description: '稳定版本' },
      { id: 'speech-02-turbo', name: 'Speech 02 Turbo', description: '稳定快速版' },
      { id: 'speech-01-hd', name: 'Speech 01 HD', description: '经典版本' },
      { id: 'speech-01-turbo', name: 'Speech 01 Turbo', description: '经典快速版' },
    ],
    speed: { min: 0.5, max: 2, normal: 1, step: 0.1, unit: '倍' },
    // These built-in voices are shared by both API sites. Account-created voices
    // must be discovered/selected again when changing sites.
    voices: [
      { id: 'Chinese (Mandarin)_Warm_Bestie', name: '温暖闺蜜', description: '普通话 · 系统音色' },
      { id: 'male-qn-qingse', name: '青涩青年', description: '中文 · 系统音色' },
    ],
  },
  qwen: {
    name: 'Qwen', dynamicVoices: false,
    sites: [{ id: 'cn', name: '北京 API', host: 'dashscope.aliyuncs.com' }, { id: 'global', name: '新加坡 API', host: 'dashscope-intl.aliyuncs.com' }],
    models: [
      { id: 'qwen3-tts-instruct-flash', name: 'Qwen3 TTS Instruct', description: '支持语气与表达描述' },
      { id: 'qwen3-tts-flash', name: 'Qwen3 TTS Flash', description: '自然语音 · 多语言' },
      { id: 'qwen3-tts-instruct-flash-2026-01-26', name: 'Qwen3 TTS Instruct · 01.26', description: '固定版本 · 表达控制' },
      { id: 'qwen3-tts-flash-2025-11-27', name: 'Qwen3 TTS Flash · 11.27', description: '固定版本 · 多语言' },
      { id: 'qwen3-tts-flash-2025-09-18', name: 'Qwen3 TTS Flash · 09.18', description: '早期版本 · 部分音色' },
    ],
    speed: null,
    voices: qwenSpeechVoices,
  },
} as const;

export interface SpeechProviderVoice { id: string; name: string; description: string }

export function isSpeechProvider(provider: string | undefined): provider is SpeechSettings['provider'] {
  return provider === 'minimax' || provider === 'qwen';
}
export function speechVoices(provider: SpeechSettings['provider'], model: string): SpeechProviderVoice[] {
  return provider === 'qwen' ? qwenSpeechVoices.filter(voice => (voice.models as readonly string[]).includes(model)) : [...speechCatalog.minimax.voices];
}
export function speechModelCapabilities(provider: SpeechSettings['provider'], model: string) {
  const known = speechCatalog[provider].models.some(item => item.id === model);
  const instruct = provider === 'qwen' && known && model.startsWith('qwen3-tts-instruct-flash');
  const expression: SpeechExpressionCapabilities = {
    emotions: provider === 'minimax' && known ? speechEmotions.filter(item => !['lively', 'whisper'].includes(item.id) || model.startsWith('speech-2.6-')).map(item => item.id) : instruct ? speechEmotions.map(item => item.id) : [],
    cues: provider === 'minimax' && model.startsWith('speech-2.8-') && known ? speechCues.map(item => item.id) : [],
    pause: provider === 'minimax' && known ? { min: 0.01, max: 99.99, step: 0.01 } : null,
    style: instruct,
  };
  return { expression, speed: speechCatalog[provider].speed, maxTextLength: provider === 'qwen' ? 600 : 3000, format: (provider === 'qwen' ? 'wav' : 'mp3') as SpeechFormat };
}
