// SPDX-License-Identifier: MIT
import type { ConnectorPlatform, ConnectorReleaseSnapshot } from './connector-release.js';

export interface ConnectorUpdatePlan {
  snapshot: ConnectorReleaseSnapshot;
  manifestSha256: string;
  platform: ConnectorPlatform;
  fromVersion: string;
  fromInstanceId: string;
}

export interface ConnectorUpdateConfirmation {
  operationId: string;
  instanceId: string;
  manifestSha256: string;
  outcome: 'succeeded' | 'rolled-back' | 'failed' | 'uncertain';
}
