# SPDX-License-Identifier: MIT
import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ncp import validate_runtime_selection


class RuntimeSelectionTests(unittest.TestCase):
    def setUp(self):
        self.vectors = json.loads((Path(__file__).resolve().parents[2] / "tests/vectors/runtime-selection.json").read_text())
        self.report = self.vectors["report"]

    def test_shared_contract_vectors(self):
        before = copy.deepcopy(self.vectors)
        for selection in self.vectors["valid"]:
            with self.subTest(valid=selection):
                validate_runtime_selection(selection, self.report)
        for selection in self.vectors["invalid"]:
            with self.subTest(invalid=selection):
                with self.assertRaises(ValueError):
                    validate_runtime_selection(selection, self.report)
        self.assertEqual(before, self.vectors)

    def test_capabilities_and_choices_must_still_be_available(self):
        model = {"model": {"model": "model-a", "provider": "one"}}
        for cap, selection in (("sessionSelection", {}), ("switchModel", model),
                               ("reasoning", dict(model, effort="high")), ("updateSettings", {"settings": {"nullable": None}})):
            report = copy.deepcopy(self.report)
            report["capabilities"][cap] = False
            with self.subTest(cap=cap), self.assertRaises(ValueError):
                validate_runtime_selection(selection, report)
        report = dict(self.report, models=[])
        with self.assertRaises(ValueError):
            validate_runtime_selection(model, report)

    def test_json_limits_and_nonfinite_numbers_are_rejected(self):
        for value in (float("nan"), float("inf"), -float("inf"), "a" * 1025):
            report = dict(self.report, settings={"allowed": {"test": [value]}})
            with self.assertRaises(ValueError):
                validate_runtime_selection({"settings": {"test": value}}, report)
        for model in ("", "界" * 86):
            report = dict(self.report, models=[{"model": model, "provider": "one"}])
            with self.assertRaises(ValueError):
                validate_runtime_selection({"model": {"model": model, "provider": "one"}}, report)
        validate_runtime_selection({"settings": {}}, dict(self.report, capabilities={"sessionSelection": True}))


if __name__ == "__main__":
    unittest.main()
