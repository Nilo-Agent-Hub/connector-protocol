// SPDX-License-Identifier: MIT
package connectorprotocol

import "fmt"

// RuntimeNativeSettings are existing native adapter contracts. They are not an
// identity allowlist or permission to forward arbitrary settings.
var RuntimeNativeSettings = []string{"codex", "claude"}

// RuntimeCapabilityExtensionKeys preserves the complete compatibility contract.
var RuntimeCapabilityExtensionKeys = []string{"maxInputLength", "modelScopes", "nativeSettings", "commands", "boundSessionSettings", "nextTurnSettings", "nextTurnModel"}

// ValidateRuntimeCapabilityExtensions retains the installed-client entry point,
// composing generic capability checks with the explicit native contract boundary.
// Other keys remain the responsibility of the enclosing wire validator.
func ValidateRuntimeCapabilityExtensions(capabilities map[string]any) error {
	if value, ok := capabilities["nativeSettings"]; ok {
		if s, ok := value.(string); !ok || !contains(RuntimeNativeSettings, s) {
			return fmt.Errorf("invalid nativeSettings")
		}
	}
	return ValidateGenericRuntimeCapabilityExtensions(capabilities)
}
