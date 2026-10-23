import type * as Core from '../contracts/runtime-core.js';
import type * as Legacy from '../contracts/runtime.js';
import { isCodexRuntimeVersion, runtimeCapabilityExtensionsError } from '../contracts/runtime.js';
import { assertRuntimeSelection } from '../contracts/runtime-selection.js';
import { report, selection, view } from '../examples/custom-runtime.js';

// Existing callers can consume a generic report/view through the compatibility facade.
const legacyReport: Legacy.RuntimeReport = report;
const legacyView: Legacy.RuntimeView = view;
const nativeCapabilities: Legacy.RuntimeCapabilities = {
  ...report.capabilities, nativeSettings: 'codex', claudeBypassPermissions: false, sideConversation: 'claude-btw',
};
const nativeReport: Legacy.RuntimeReport = { ...legacyReport, capabilities: nativeCapabilities, claude: { settings: { permissionMode: 'plan' }, source: 'configuration', conversion: 'native' } };
assertRuntimeSelection(selection, nativeReport);
isCodexRuntimeVersion('1.2.3');
runtimeCapabilityExtensionsError(nativeCapabilities as unknown as Record<string, unknown>);
const nativeRequest: Legacy.RuntimeRequest['payload'] = { settings: { approvalPolicy: 'on-request' }, claudeSettings: { effort: 'high' } };
const nativeKind: Legacy.RuntimeRequestKind = 'update-claude-settings';

// New callers use scalar settings without importing native options or an adapter enum.
const genericPayload: Core.RuntimeRequest['payload'] = { settings: { 'custom.mode': 'fast', temperature: 0.5 } };
// @ts-expect-error Public reports cannot acquire a brand field.
const brandedReport: Core.RuntimeReport = { ...report, claudeInstanceId: 'legacy-id' };
// @ts-expect-error Public capabilities do not advertise native adapter contracts.
const brandedCapability: Core.RuntimeCapabilities = { ...report.capabilities, nativeSettings: 'codex' };
// @ts-expect-error Public request kinds do not include legacy native update commands.
const brandedRequest: Core.RuntimeRequestKind = 'update-codex';
// @ts-expect-error Generic settings remain scalars, not arbitrary configuration objects.
const nestedSetting: Core.RuntimeSelection = { settings: { config: { arbitrary: true } } };
// @ts-expect-error Existing native settings still enforce the approved enum.
const invalidNative: Legacy.RuntimeRequest['payload'] = { settings: { approvalPolicy: 'arbitrary' } };
// @ts-expect-error Existing native contracts remain closed.
const unknownNative: Legacy.RuntimeNativeSettings = 'org.example.independent-agent';
void [legacyView, nativeRequest, nativeKind, genericPayload, brandedReport, brandedCapability, brandedRequest, nestedSetting, invalidNative, unknownNative];
