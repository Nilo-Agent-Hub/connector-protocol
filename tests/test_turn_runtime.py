# SPDX-License-Identifier: MIT
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from ncp import validate_turn_runtime


class TurnRuntimeTest(unittest.TestCase):
    def test_wire_shape(self):
        runtime = {"model": "native", "effort": None, "settings": {"networkAccess": False}}
        for value in [None, runtime, dict(runtime, model=None)]:
            validate_turn_runtime(value)
        for value in [{}, dict(runtime, model="m"*257), dict(runtime, effort="e"*65),
                      dict(runtime, settings={str(i): True for i in range(17)}),
                      dict(runtime, settings={"a": 1}), dict(runtime, settings={"a": {}})]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_turn_runtime(value)
