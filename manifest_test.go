package connectorprotocol

import "testing"

func TestManifestValidationAndApprovalIdentity(t *testing.T) {
	valid := Manifest{SchemaVersion: 1, ID: "org.example.echo", Name: "Echo 示例", Version: "1.2.0-rc.1", Protocol: Protocol{Major: 1}, Capabilities: []string{"channel.receive", "channel.send"}}
	if err := valid.Validate(); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*Manifest){
		"official-looking short id": func(m *Manifest) { m.ID = "codex" },
		"path traversal id":         func(m *Manifest) { m.ID = "org.example/../echo" },
		"control in display name":   func(m *Manifest) { m.Name = "Echo\nOfficial" },
		"unknown permission":        func(m *Manifest) { m.Capabilities = append(m.Capabilities, "shell.exec") },
		"duplicate permission":      func(m *Manifest) { m.Capabilities = append(m.Capabilities, "channel.send") },
		"missing receive":           func(m *Manifest) { m.Capabilities = []string{"channel.send", "channel.stream"} },
		"future protocol":           func(m *Manifest) { m.Protocol.Minor = 3 },
	} {
		t.Run(name, func(t *testing.T) {
			m := valid
			m.Capabilities = append([]string{}, valid.Capabilities...)
			mutate(&m)
			if m.Validate() == nil {
				t.Fatal("unsupported manifest accepted")
			}
		})
	}
	reordered := valid
	reordered.Capabilities = []string{"channel.send", "channel.receive"}
	if !Equal(&valid, &reordered) || valid.Digest() != reordered.Digest() {
		t.Fatal("capability ordering changes approval identity")
	}
	if reordered.Capabilities[0] != "channel.send" {
		t.Fatal("digest mutated caller's declaration")
	}
	duplicates := valid
	duplicates.Capabilities = []string{"channel.send", "channel.send"}
	if Equal(&duplicates, &valid) || Equal(&valid, &duplicates) {
		t.Fatal("duplicate capability changed approval comparison into a subset check")
	}
	reordered.Version = "1.2.1"
	if Equal(&valid, &reordered) || valid.Digest() == reordered.Digest() {
		t.Fatal("upgraded version reuses owner approval")
	}
}
