// SPDX-License-Identifier: MIT
package connectorprotocol

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"unicode/utf8"
)

// RuntimeModelScopes are the NCP 1.2 scopes in which an owner may choose a model.
var RuntimeModelScopes = []string{"draft", "conversation", "defaults"}

// RuntimeNativeSettings are the NCP 1.2 native settings contract ids.
var RuntimeNativeSettings = []string{"codex", "claude"}

const RuntimeMaxInputLength = 1000000
const RuntimeMaxCommands = 64

// RuntimeCommand is one text command a runtime understands.
type RuntimeCommand struct {
	Command     string `json:"command"`
	Description string `json:"description"`
	Usage       string `json:"usage,omitempty"`
	NewTopic    bool   `json:"newTopic,omitempty"`
}

var settingKey = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_.-]{0,63}$`)

var runtimeCommand = regexp.MustCompile(`^/[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)

// RuntimeCapabilityExtensionKeys are the optional NCP 1.2 RuntimeReport.capabilities fields.
var RuntimeCapabilityExtensionKeys = []string{"maxInputLength", "modelScopes", "nativeSettings", "commands", "boundSessionSettings", "nextTurnSettings", "nextTurnModel"}

// ValidateRuntimeCapabilityExtensions checks the NCP 1.2 fields of a decoded
// RuntimeReport.capabilities object. Other keys are ignored here.
func ValidateRuntimeCapabilityExtensions(capabilities map[string]any) error {
	if value, ok := capabilities["maxInputLength"]; ok {
		n, ok := value.(float64)
		if !ok || n != math.Trunc(n) || n < 1 || n > RuntimeMaxInputLength {
			return fmt.Errorf("invalid maxInputLength")
		}
	}
	if value, ok := capabilities["modelScopes"]; ok {
		scopes, ok := value.([]any)
		if !ok || len(scopes) > len(RuntimeModelScopes) {
			return fmt.Errorf("invalid modelScopes")
		}
		seen := map[string]bool{}
		for _, raw := range scopes {
			scope, ok := raw.(string)
			if !ok || seen[scope] || !contains(RuntimeModelScopes, scope) {
				return fmt.Errorf("invalid modelScopes")
			}
			seen[scope] = true
		}
	}
	if value, ok := capabilities["nativeSettings"]; ok {
		if s, ok := value.(string); !ok || !contains(RuntimeNativeSettings, s) {
			return fmt.Errorf("invalid nativeSettings")
		}
	}
	if value, ok := capabilities["boundSessionSettings"]; ok {
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("invalid boundSessionSettings")
		}
	}
	if value, ok := capabilities["nextTurnSettings"]; ok {
		keys, ok := value.([]any)
		if !ok || len(keys) > 64 {
			return fmt.Errorf("invalid nextTurnSettings")
		}
		seen := map[string]bool{}
		for _, raw := range keys {
			key, ok := raw.(string)
			if !ok || !settingKey.MatchString(key) || seen[key] {
				return fmt.Errorf("invalid nextTurnSettings")
			}
			seen[key] = true
		}
	}
	if value, ok := capabilities["nextTurnModel"]; ok {
		enabled, ok := value.(bool)
		if !ok || enabled && capabilities["switchModel"] != true {
			return fmt.Errorf("invalid nextTurnModel")
		}
	}
	if value, ok := capabilities["commands"]; ok {
		commands, ok := value.([]any)
		if !ok || len(commands) > RuntimeMaxCommands {
			return fmt.Errorf("invalid commands")
		}
		seen := map[string]bool{}
		for _, raw := range commands {
			item, ok := raw.(map[string]any)
			if !ok {
				return fmt.Errorf("invalid commands")
			}
			for key := range item {
				if !contains([]string{"command", "description", "usage", "newTopic"}, key) {
					return fmt.Errorf("invalid commands")
				}
			}
			command, ok := item["command"].(string)
			if !ok || !runtimeCommand.MatchString(command) || seen[strings.ToLower(command)] {
				return fmt.Errorf("invalid commands")
			}
			seen[strings.ToLower(command)] = true
			if !boundedText(item["description"]) {
				return fmt.Errorf("invalid commands")
			}
			if usage, ok := item["usage"]; ok && !boundedText(usage) {
				return fmt.Errorf("invalid commands")
			}
			if newTopic, ok := item["newTopic"]; ok {
				if _, ok := newTopic.(bool); !ok {
					return fmt.Errorf("invalid commands")
				}
			}
		}
	}
	return nil
}

// StartsNewTopic reports whether text invokes a declared newTopic command: the
// command, optionally followed by @name, then whitespace or the end of input.
func StartsNewTopic(commands []RuntimeCommand, text string) bool {
	fields := strings.Fields(text)
	if len(fields) == 0 {
		return false
	}
	head := strings.ToLower(fields[0])
	if at := strings.IndexByte(head, '@'); at > 0 {
		head = head[:at]
	}
	for _, command := range commands {
		if command.NewTopic && strings.ToLower(command.Command) == head {
			return true
		}
	}
	return false
}

func boundedText(value any) bool {
	s, ok := value.(string)
	n := utf8.RuneCountInString(s)
	return ok && n >= 1 && n <= 200
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}
