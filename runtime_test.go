// SPDX-License-Identifier: MIT
package connectorprotocol

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

type runtimeVectors struct {
	Valid    []map[string]any `json:"valid"`
	Invalid  []map[string]any `json:"invalid"`
	NewTopic struct {
		Commands []RuntimeCommand `json:"commands"`
		Cases    [][2]any         `json:"cases"`
	} `json:"newTopic"`
}

func loadRuntimeVectors(t *testing.T) runtimeVectors {
	t.Helper()
	raw, err := os.ReadFile("tests/vectors/runtime-capabilities.json")
	if err != nil {
		t.Fatal(err)
	}
	var v runtimeVectors
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestRuntimeCapabilityExtensions(t *testing.T) {
	v := loadRuntimeVectors(t)
	for _, c := range v.Valid {
		if err := ValidateRuntimeCapabilityExtensions(c); err != nil {
			t.Fatal(c, err)
		}
	}
	for _, c := range v.Invalid {
		if ValidateRuntimeCapabilityExtensions(c) == nil {
			t.Fatal("accepted", c)
		}
	}
}

func TestGenericRuntimeCapabilityExtensions(t *testing.T) {
	v := loadRuntimeVectors(t)
	for _, c := range v.Valid {
		generic := make(map[string]any, len(c))
		for key, value := range c {
			if key != "nativeSettings" {
				generic[key] = value
			}
		}
		if err := ValidateGenericRuntimeCapabilityExtensions(generic); err != nil {
			t.Fatal(generic, err)
		}
	}
	for _, c := range v.Invalid {
		if _, native := c["nativeSettings"]; native {
			continue
		}
		if ValidateGenericRuntimeCapabilityExtensions(c) == nil {
			t.Fatal("accepted", c)
		}
	}
	if contains(GenericRuntimeCapabilityExtensionKeys, "nativeSettings") || !contains(RuntimeCapabilityExtensionKeys, "nativeSettings") {
		t.Fatal("native settings escaped its compatibility boundary")
	}
	for _, native := range []any{"org.example.independent-agent", "", nil, true, map[string]any{"mode": "custom"}} {
		if ValidateRuntimeCapabilityExtensions(map[string]any{"nativeSettings": native}) == nil {
			t.Fatal("accepted unknown native settings contract", native)
		}
	}
}

func TestStartsNewTopic(t *testing.T) {
	v := loadRuntimeVectors(t)
	for _, c := range v.NewTopic.Cases {
		if StartsNewTopic(v.NewTopic.Commands, c[0].(string)) != c[1].(bool) {
			t.Fatal(c)
		}
	}
}

func TestProtocolMinorTwoAccepted(t *testing.T) {
	m := Manifest{SchemaVersion: 1, ID: "org.example.echo", Name: "Echo", Version: "1.0.0", Protocol: Protocol{Major: 1, Minor: 2}, Capabilities: []string{"channel.receive", "channel.send", "runtime.manage"}}
	if err := m.Validate(); err != nil {
		t.Fatal(err)
	}
	m.Protocol.Minor = 3
	if m.Validate() == nil {
		t.Fatal("future minor accepted")
	}
}

func TestValidateSessionFailure(t *testing.T) {
	good := []map[string]any{{"reason": "quota"}, {"reason": "quota", "resetsAt": "2026-11-28T10:40:00Z", "scope": "5 小时额度"}, {"reason": "future", "resetsAt": nil, "scope": nil}}
	for _, v := range good {
		if err := ValidateSessionFailure(v); err != nil {
			t.Fatalf("%v: %v", v, err)
		}
	}
	bad := []map[string]any{{}, {"reason": ""}, {"reason": "quota", "extra": 1}, {"reason": "quota", "resetsAt": "soon"}, {"reason": "quota", "scope": " "}, {"reason": "quota", "scope": strings.Repeat("x", 61)}}
	for _, v := range bad {
		if ValidateSessionFailure(v) == nil {
			t.Fatalf("accepted %v", v)
		}
	}
}
