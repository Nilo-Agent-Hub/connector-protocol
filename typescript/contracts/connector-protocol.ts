// SPDX-License-Identifier: MIT
/** Public NCP manifest; the server validates the versioned JSON Schema contract. */
export interface ConnectorManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  protocol: { major: number; minor: number };
  capabilities: string[];
}

/** Capability descriptions explain the actual grant, independent of Agent brands. */
export const connectorCapabilityLabels: Readonly<Record<string, string>> = {
  'channel.receive': '接收发给此 Agent 的消息',
  'channel.send': '在此 Agent 的话题中回复',
  'channel.stream': '更新此 Agent 的流式回复',
  'conversation.create': '主动创建此 Agent 的话题',
  'profile.write': '修改此 Agent 的名称和头像',
  'channel.attachments': '收发此 Agent 的附件',
  'channel.metadata': '同步工具进度与消息状态',
  'runtime.manage': '管理此 Agent 的运行环境',
  'native.sessions': '同步和连接原生会话',
  'coding.sessions': '同步执行会话与项目',
  'coding.actions': '领取执行控制指令',
  'coding.approvals': '请求与同步操作审批',
  'files.read': '读取经授权的工作区文件',
  'files.write': '传输文件到授权工作区',
  'media.generate': '使用已配置的图片和语音服务',
  'questions': '提问并接收用户回答',
  'stickers': '使用与注册贴纸',
};

/** Capability authorization never depends on a provider or display brand. */
export function hasCapability(manifest: ConnectorManifest | null | undefined, capability: string): boolean {
  return manifest?.capabilities.includes(capability) === true;
}
