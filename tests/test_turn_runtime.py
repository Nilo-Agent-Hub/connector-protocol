# SPDX-License-Identifier: MIT
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from ncp import validate_session_failure, validate_turn_runtime


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


class SessionFailureTest(unittest.TestCase):
    def test_wire_shape(self):
        for value in [None, {"reason": "quota"}, {"reason": "quota", "resetsAt": "2026-11-28T10:40:00Z", "scope": "5 小时额度"},
                      {"reason": "future", "resetsAt": None, "scope": None}]:
            validate_session_failure(value)
        for value in [{}, {"reason": ""}, {"reason": "quota", "extra": 1}, {"reason": "quota", "resetsAt": "soon"},
                      {"reason": "quota", "scope": " "}, {"reason": "quota", "scope": "x" * 61}]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_session_failure(value)
