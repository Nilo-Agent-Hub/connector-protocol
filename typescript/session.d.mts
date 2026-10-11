// SPDX-License-Identifier: MIT
export interface ConnectorManifest {
  schemaVersion: 1; id: string; name: string; version: string;
  protocol: { major: 1; minor: number }; capabilities: string[];
}
export interface NcpSessionOptions {
  baseUrl: string; token: string; managementToken?: string; manifest: ConnectorManifest;
  instanceId?: string; fetcher?: typeof fetch; headers?: HeadersInit; onError?: (error: NcpError) => void;
}
export const INSTANCE_HEADER: string;
export class NcpError extends Error { status: number; code: string; constructor(status: number, code: string); }
export class NcpSession {
  constructor(options: NcpSessionOptions);
  readonly instanceId: string; readonly manifest: ConnectorManifest; readonly agentId?: string;
  ready(): Promise<void>;
  fetch(path: string, init?: RequestInit, management?: boolean): Promise<Response>;
  close(): Promise<void>;
}
