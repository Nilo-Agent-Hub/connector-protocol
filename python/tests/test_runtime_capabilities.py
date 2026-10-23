import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ncp import validate_generic_runtime_capabilities, validate_runtime_capabilities


class RuntimeCapabilityBoundaryTests(unittest.TestCase):
    def test_generic_extensions_follow_shared_vectors(self):
        vectors = json.loads((Path(__file__).resolve().parents[2] / "tests/vectors/runtime-capabilities.json").read_text())
        for value in vectors["valid"]:
            with self.subTest(value=value):
                validate_generic_runtime_capabilities({key: item for key, item in value.items() if key != "nativeSettings"})
                validate_runtime_capabilities(value)
        for value in vectors["invalid"]:
            if "nativeSettings" in value:
                continue
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_generic_runtime_capabilities(value)

    def test_native_contract_boundary_remains_closed(self):
        for native in ["codex", "claude"]:
            validate_runtime_capabilities({"nativeSettings": native})
        for native in ["org.example.independent-agent", "", None, True, {"mode": "custom"}]:
            with self.subTest(native=native), self.assertRaisesRegex(ValueError, "nativeSettings"):
                validate_runtime_capabilities({"nativeSettings": native})
