// SPDX-License-Identifier: MIT
/** Compatibility facade. New Connectors use runtime-core; native adapters use runtime-compat. */
export * from './runtime-core.js';
export {
  type ClaudeSettings, type ClaudeSelection, type ModelApiMode, type ModelConnection, type ModelConnectionInput,
  type CodexUpdateInfo, type ConnectorUpdateStatus, type ConnectorUpdateError, type ConnectorUpdateInfo,
  isCodexRuntimeVersion, type RuntimeNativeSettings, type RuntimeCapabilities, runtimeCapabilityExtensionsError,
  type RuntimeReport, type RuntimeRequestKind, type RuntimeRequest, type RuntimeListChangesRequest,
  type RuntimeReadDiffRequest, type RuntimeReviewRequest, type RuntimeView, type ConnectionsSnapshot,
  runtimeErrorMessages, runtimeError,
} from './runtime-compat.js';
