// SPDX-License-Identifier: MIT
// Package connectorprotocol defines the independently implementable NCP v1 contract.
package connectorprotocol

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

const Version = "1.1.0"
const ProtocolMinor = 1

const InstanceHeader = "X-Nilo-Connector-Instance"
const LeaseSeconds = 90
const HeartbeatIntervalSeconds = 30

type Protocol struct {
	Major int `json:"major"`
	Minor int `json:"minor"`
}

type Manifest struct {
	SchemaVersion int      `json:"schemaVersion"`
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Version       string   `json:"version"`
	Protocol      Protocol `json:"protocol"`
	Capabilities  []string `json:"capabilities"`
}

var identifier = regexp.MustCompile(`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*){2,}$`)
var version = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$`)

// Validate rejects capabilities this Hub cannot enforce. A declaration is never
// a grant: the owner approves this exact manifest during device pairing.
func (m Manifest) Validate() error {
	if m.SchemaVersion != 1 || (m.Protocol.Major != 1 || m.Protocol.Minor < 0 || m.Protocol.Minor > ProtocolMinor) {
		return fmt.Errorf("unsupported connector protocol")
	}
	if len(m.ID) > 128 || !identifier.MatchString(m.ID) {
		return fmt.Errorf("invalid namespaced connector id")
	}
	if utf8.RuneCountInString(m.Name) < 1 || utf8.RuneCountInString(m.Name) > 80 || strings.TrimSpace(m.Name) != m.Name || strings.IndexFunc(m.Name, unicode.IsControl) >= 0 {
		return fmt.Errorf("invalid connector name")
	}
	if len(m.Version) > 64 || !version.MatchString(m.Version) {
		return fmt.Errorf("invalid connector version")
	}
	if len(m.Capabilities) < 2 || len(m.Capabilities) > len(Capabilities) {
		return fmt.Errorf("invalid connector capabilities")
	}
	seen := map[string]bool{}
	for _, capability := range m.Capabilities {
		if seen[capability] {
			return fmt.Errorf("duplicate connector capability")
		}
		seen[capability] = true
		switch capability {
		case "channel.receive", "channel.send", "channel.stream", "conversation.create", "profile.write":
		case "channel.attachments", "channel.metadata", "runtime.manage", "native.sessions", "coding.sessions", "coding.actions", "coding.approvals", "files.read", "files.write", "media.generate", "questions", "stickers":
			if m.Protocol.Minor < 1 {
				return fmt.Errorf("capability requires NCP 1.1: %s", capability)
			}
		default:
			return fmt.Errorf("unsupported connector capability: %s", capability)
		}
	}
	if !seen["channel.receive"] || !seen["channel.send"] {
		return fmt.Errorf("channel.receive and channel.send are required")
	}
	return nil
}

func (m Manifest) Has(capability string) bool { return slices.Contains(m.Capabilities, capability) }

// Equal compares immutable approvals; capability order has no meaning.
func Equal(a, b *Manifest) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	if a.SchemaVersion != b.SchemaVersion || a.ID != b.ID || a.Name != b.Name || a.Version != b.Version || a.Protocol != b.Protocol || len(a.Capabilities) != len(b.Capabilities) {
		return false
	}
	left, right := slices.Clone(a.Capabilities), slices.Clone(b.Capabilities)
	slices.Sort(left)
	slices.Sort(right)
	return slices.Equal(left, right)
}

// Digest binds an owner approval to the displayed declaration. Capabilities
// are sorted before hashing canonical struct JSON; no whitespace is emitted.
func (m Manifest) Digest() string {
	m.Capabilities = slices.Clone(m.Capabilities)
	slices.Sort(m.Capabilities)
	raw, _ := json.Marshal(m)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// Capabilities is the versioned, vendor-independent grant vocabulary.
var Capabilities = []string{"channel.receive", "channel.send", "channel.stream", "conversation.create", "profile.write", "channel.attachments", "channel.metadata", "runtime.manage", "native.sessions", "coding.sessions", "coding.actions", "coding.approvals", "files.read", "files.write", "media.generate", "questions", "stickers"}
