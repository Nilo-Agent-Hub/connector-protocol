// SPDX-License-Identifier: MIT
package connectorprotocol

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// RuntimeModelScopes are the NCP 1.2 scopes in which an owner may choose a model.
var RuntimeModelScopes = []string{"draft", "conversation", "defaults"}

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

// GenericRuntimeCapabilityExtensionKeys are the provider-independent NCP 1.2 capability fields.
var GenericRuntimeCapabilityExtensionKeys = []string{"maxInputLength", "modelScopes", "commands", "boundSessionSettings", "nextTurnSettings", "nextTurnModel", "reviewUncommitted", "liveTurnSettings"}

// ValidateGenericRuntimeCapabilityExtensions checks provider-independent NCP 1.2
// capability extensions. The enclosing wire boundary validates all other keys.
func ValidateGenericRuntimeCapabilityExtensions(capabilities map[string]any) error {
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
	if value, ok := capabilities["reviewUncommitted"]; ok {
		enabled, ok := value.(bool)
		if !ok || enabled && capabilities["reviewChanges"] != true {
			return fmt.Errorf("invalid reviewUncommitted")
		}
	}
	if value, ok := capabilities["liveTurnSettings"]; ok {
		keys, valid := value.([]any)
		next, hasNext := capabilities["nextTurnSettings"].([]any)
		if !valid || !hasNext || len(keys) > 64 || capabilities["updateSettings"] != true {
			return fmt.Errorf("invalid liveTurnSettings")
		}
		seen := map[string]bool{}
		for _, raw := range keys {
			key, valid := raw.(string)
			declared := false
			for _, candidate := range next {
				if candidate == key {
					declared = true
				}
			}
			if !valid || !settingKey.MatchString(key) || seen[key] || !declared {
				return fmt.Errorf("invalid liveTurnSettings")
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

// ValidateTurnRuntime validates a non-null, decoded native turn observation.
// The enclosing session or input may omit the observation or send null.
func ValidateTurnRuntime(o map[string]any) error {
	if len(o) != 3 {
		return fmt.Errorf("invalid turnRuntime")
	}
	for key, limit := range map[string]int{"model": 256, "effort": 64} {
		value, exists := o[key]
		if !exists {
			return fmt.Errorf("missing %s", key)
		}
		if value != nil {
			s, ok := value.(string)
			if !ok || len(s) == 0 || utf8.RuneCountInString(s) > limit {
				return fmt.Errorf("invalid %s", key)
			}
		}
	}
	settings, ok := o["settings"].(map[string]any)
	if !ok || settings == nil || len(settings) > 16 {
		return fmt.Errorf("invalid turn settings")
	}
	for _, v := range settings {
		switch v.(type) {
		case bool, string:
		default:
			return fmt.Errorf("invalid turn setting value")
		}
	}
	return nil
}

// ValidateSessionFailure validates a non-null, decoded classified failure of a
// failed coding session. Unknown reasons are accepted and read as unclassified.
func ValidateSessionFailure(o map[string]any) error {
	for key := range o {
		if key != "reason" && key != "resetsAt" && key != "scope" {
			return fmt.Errorf("invalid failure key %s", key)
		}
	}
	reason, ok := o["reason"].(string)
	if !ok || len(reason) == 0 || len(reason) > 64 {
		return fmt.Errorf("invalid failure reason")
	}
	if v := o["resetsAt"]; v != nil {
		s, ok := v.(string)
		if !ok {
			return fmt.Errorf("invalid failure resetsAt")
		}
		if _, err := time.Parse(time.RFC3339Nano, s); err != nil {
			return fmt.Errorf("invalid failure resetsAt")
		}
	}
	if v := o["scope"]; v != nil {
		s, ok := v.(string)
		if !ok || strings.TrimSpace(s) == "" || utf8.RuneCountInString(s) > 60 {
			return fmt.Errorf("invalid failure scope")
		}
	}
	return nil
}
