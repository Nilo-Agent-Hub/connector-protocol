// SPDX-License-Identifier: MIT
// Signed release identity is a compatibility contract; source and product names use Connector.
export const CONNECTOR_RELEASE_REPOSITORY = 'zkywalker/agent-inbox-codex-bridge';
export const CONNECTOR_PLATFORMS = ['linux-x64', 'darwin-x64', 'darwin-arm64'] as const;
export type ConnectorPlatform = typeof CONNECTOR_PLATFORMS[number];

export const CONNECTOR_MANIFEST_SIGNATURE_DOMAIN = 'agent-inbox-bridge-manifest:v1\n';
export interface ConnectorManifestSignature {
  schemaVersion: 1;
  algorithm: 'ed25519';
  keyId: string;
  signature: string;
}

export interface ConnectorReleaseAsset {
  platform: ConnectorPlatform;
  name: string;
  size: number;
  sha256: string;
}

export interface ConnectorReleaseManifest {
  schemaVersion: 1;
  repository: typeof CONNECTOR_RELEASE_REPOSITORY;
  version: string;
  publishedAt: string;
  expiresAt: string;
  assets: ConnectorReleaseAsset[];
}

export interface ConnectorReleaseSnapshot {
  manifest: string;
  signature: string;
}
