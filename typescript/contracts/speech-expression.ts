// SPDX-License-Identifier: MIT
import type { SpeechExpression } from './speech-generation.js';

/** Portable controls. Vendor syntax is compiled only in the gateway adapter. */
export const speechEmotions = [
  { id: 'happy', name: '开心' }, { id: 'sad', name: '悲伤' },
  { id: 'angry', name: '生气' }, { id: 'fearful', name: '害怕' },
  { id: 'disgusted', name: '厌恶' }, { id: 'surprised', name: '惊讶' },
  { id: 'calm', name: '平静' }, { id: 'lively', name: '生动' }, { id: 'whisper', name: '低语' },
] as const;
export type SpeechEmotion = typeof speechEmotions[number]['id'];
export const speechCues = [
  { id: 'laugh', name: '笑声' }, { id: 'chuckle', name: '轻笑' },
  { id: 'sigh', name: '叹气' }, { id: 'breath', name: '换气' },
  { id: 'gasp', name: '倒吸气' }, { id: 'hum', name: '哼唱' },
  { id: 'cough', name: '咳嗽' }, { id: 'clear_throat', name: '清嗓' },
  { id: 'groan', name: '呻吟' }, { id: 'pant', name: '喘气' },
  { id: 'inhale', name: '吸气' }, { id: 'exhale', name: '呼气' },
  { id: 'sniff', name: '吸鼻子' }, { id: 'snort', name: '喷鼻息' },
  { id: 'burp', name: '打嗝' }, { id: 'lip_smack', name: '咂嘴' },
  { id: 'hiss', name: '嘶嘶声' }, { id: 'hmm', name: '嗯' }, { id: 'sneeze', name: '喷嚏' },
] as const;
export type SpeechCue = typeof speechCues[number]['id'];
export interface SpeechExpressionCapabilities {
  emotions: readonly SpeechEmotion[];
  cues: readonly SpeechCue[];
  pause: { min: number; max: number; step: number } | null;
  style: boolean;
}
export type SpeechTextPart = { kind: 'text'; text: string } | { kind: 'cue'; cue: SpeechCue } | { kind: 'pause'; seconds: number };
export function parseSpeechText(text: string): SpeechTextPart[] {
  const parts: SpeechTextPart[] = [];
  const pattern = /\[\[([^\[\]]*)\]\]/g;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    parts.push({ kind: 'text', text: text.slice(offset, match.index) });
    const token = match[1];
    if (speechCues.some(cue => cue.id === token)) parts.push({ kind: 'cue', cue: token as SpeechCue });
    else if (/^pause:\d+(?:\.\d{1,2})?$/.test(token)) parts.push({ kind: 'pause', seconds: Number(token.slice(6)) });
    else throw new Error('无法识别表达标记，请从表达面板重新插入。');
    offset = match.index! + match[0].length;
  }
  parts.push({ kind: 'text', text: text.slice(offset) });
  if (parts.some(part => part.kind === 'text' && /\[\[|\]\]/.test(part.text))) throw new Error('表达标记不完整，请检查双括号。');
  return parts;
}
export function speechExpressionError(text: string, expression: SpeechExpression, capabilities: SpeechExpressionCapabilities): string | null {
  if (expression.emotion && !capabilities.emotions.includes(expression.emotion)) return '当前模型不支持所选语气，请更换语气或恢复自动。';
  if (expression.style?.trim() && !capabilities.style) return '当前模型不支持表达描述，内容已保留，请清空描述或切换模型。';
  try {
    const parts = parseSpeechText(text);
    for (const [index, part] of parts.entries()) {
      if (part.kind === 'cue' && !capabilities.cues.includes(part.cue)) return '当前模型不支持文本中的声音标记，请移除标记或切换模型。';
      if (part.kind !== 'pause') continue;
      if (!capabilities.pause) return '当前模型不支持定时停顿，请移除停顿标记或切换模型。';
      if (part.seconds < capabilities.pause.min || part.seconds > capabilities.pause.max) return `停顿需在 ${capabilities.pause.min}–${capabilities.pause.max} 秒之间。`;
      // The provider requires speech on both sides, with no adjacent pauses.
      const previous = parts[index - 1], next = parts[index + 1];
      if (previous?.kind !== 'text' || !/[\p{L}\p{N}]/u.test(previous.text) || next?.kind !== 'text' || !/[\p{L}\p{N}]/u.test(next.text)) return '请将停顿放在两段可朗读文字之间，不要连续插入。';
    }
  } catch (error) { return (error as Error).message; }
  return null;
}
