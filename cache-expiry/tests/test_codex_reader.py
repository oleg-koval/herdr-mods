import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "codex_reader", Path(__file__).resolve().parents[1] / "mods/cache-expiry/codex-cache-read.py",
)
reader = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reader)
SESSION = "12345678-abcd-1234-abcd-123456789abc"


def token_row(input_tokens, cached):
    return {"type": "event_msg", "payload": {"type": "token_count", "info": {
        "last_token_usage": {"input_tokens": input_tokens, "cached_input_tokens": cached},
    }}}


class TestCodexReader(unittest.TestCase):
    def test_reads_only_the_latest_valid_main_session_counts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            path = root / f"rollout-fixture-{SESSION}.jsonl"

            def write(session_id):
                meta = {"type": "session_meta", "payload": {"id": SESSION, "session_id": session_id}}
                rows = [meta, token_row(100, 80), token_row(90, 0), token_row(20, 21)]
                path.write_text("\n".join(map(json.dumps, rows)) + "\n{\"partial\":")

            write(SESSION)
            self.assertEqual(reader.last_usage(path, root), {"input": 90, "cached": 0})
            self.assertIsNone(reader.last_usage(path, root / "different-root"))
            write("other")
            self.assertIsNone(reader.last_usage(path, root))

    def test_skips_ambiguous_or_stale_terminal_bindings(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve()
            root = home / ".codex/sessions"
            root.mkdir(parents=True)
            path = root / f"rollout-fixture-{SESSION}.jsonl"
            rows = [{"type": "session_meta", "payload": {"id": SESSION, "session_id": SESSION}}, token_row(8, 5)]
            path.write_text("\n".join(map(json.dumps, rows)) + "\n")

            def fake_command(*argv):
                if argv[0] == "lsof":
                    self.assertEqual(argv[3], "123,456")
                    return f"p123\nn{path}\nn{path}\np456\nn{path}\nn{root / 'rollout-other.jsonl'}"
                pid = {"t1": 123, "t2": 456, "t3": 789}[argv[2]]
                return json.dumps({"status": {"app": "codex"}, "foreground": {
                    "pid": pid, "name": "codex" if pid != 789 else "zsh",
                }})

            with patch.object(reader.Path, "home", return_value=home), patch.object(reader, "command", fake_command):
                self.assertEqual(reader.main(["t1", "t2", "t3", "remote/t4"]), {"t1": {"input": 8, "cached": 5}})
