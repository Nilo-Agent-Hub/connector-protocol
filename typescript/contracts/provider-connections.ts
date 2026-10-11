// SPDX-License-Identifier: MIT
import { isSpeechProvider } from './speech-catalog.js';
import type { ModelApiMode, ModelConnection } from './runtime.js';

export const modelProviders = [
  { id: 'custom', name: '自定义 / 兼容服务', description: '第三方平台、代理或本地接口' },
  { id: 'minimax', name: 'MiniMax 官方', description: '聊天与语音使用各自接口' },
  { id: 'qwen', name: '阿里云百炼（Qwen）', description: '千问对话与语音' },
  { id: 'openai', name: 'OpenAI 官方', description: '聊天与 Images API' },
  { id: 'anthropic', name: 'Anthropic 官方', description: 'Messages API' },
] as const;
export type ModelProvider = typeof modelProviders[number]['id'];
export type ProviderSite = 'cn' | 'global' | 'custom';
export function providerName(provider?: ModelProvider) { return modelProviders.find(item => item.id === provider)?.name ?? modelProviders[0].name; }
export function providerSites(provider: ModelProvider) {
  if (provider === 'minimax') return [{ id: 'cn' as const, name: '中国大陆 API', host: 'api.minimaxi.com' }, { id: 'global' as const, name: '国际 API', host: 'api.minimax.io' }];
  if (provider === 'qwen') return [{ id: 'cn' as const, name: '北京 API', host: 'dashscope.aliyuncs.com' }, { id: 'global' as const, name: '新加坡 API', host: 'dashscope-intl.aliyuncs.com' }];
  if (provider === 'openai') return [{ id: 'global' as const, name: '官方 API', host: 'api.openai.com' }];
  if (provider === 'anthropic') return [{ id: 'global' as const, name: '官方 API', host: 'api.anthropic.com' }];
  return [{ id: 'custom' as const, name: '自定义 API', host: '' }];
}
export function providerBaseUrl(provider: ModelProvider, site: ProviderSite, apiMode: ModelApiMode) {
  if (provider === 'minimax') return `https://${site === 'cn' ? 'api.minimaxi.com' : 'api.minimax.io'}/${apiMode === 'anthropic_messages' ? 'anthropic' : 'v1'}`;
  if (provider === 'qwen') return `https://${site === 'cn' ? 'dashscope.aliyuncs.com' : 'dashscope-intl.aliyuncs.com'}/compatible-mode/v1`;
  if (provider === 'openai') return 'https://api.openai.com/v1';
  if (provider === 'anthropic') return 'https://api.anthropic.com/v1';
  return '';
}
export function speechConnection(connection: Pick<ModelConnection, 'provider' | 'site' | 'baseUrl' | 'apiMode'> | undefined | null) {
  if (!connection || !isSpeechProvider(connection.provider) || !['cn', 'global'].includes(connection.site ?? '')) return null;
  if (connection.baseUrl.replace(/\/+$/, '') !== providerBaseUrl(connection.provider, connection.site!, connection.apiMode)) return null;
  return { provider: connection.provider, region: connection.site as 'cn' | 'global' };
}
