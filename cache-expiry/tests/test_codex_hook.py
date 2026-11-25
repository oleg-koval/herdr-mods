import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / "mods/cache-expiry/codex-cache-hook.py"
spec = importlib.util.spec_from_file_location("codex_cache_hook", path)
hook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook)
SESSION = "12345678-abcd-4567-8901-123456789abc"
SAMPLE = {
    "hook_event_name": "PostModelRequest", "kind": "Sampling", "status": "completed",
    "session_id": SESSION, "thread_id": SESSION,
    "token_usage": {"input_tokens": 1000, "cached_input_tokens": 750},
}


class CodexCacheHook(TestCase):
    def test_new_session_clears_previous_usage(self):
        self.assertEqual(hook.labels_for({"hook_event_name": "SessionStart", "session_id": SESSION}),
                         [f"codex.cache.session={SESSION}", "codex.cache.usage="])

    def test_reports_top_level_sampling_on_the_associated_terminal(self):
        with (patch.dict(hook.os.environ, {"HC_TERMINAL_ID": "t16"}),
              patch.object(hook.sys, "stdin", SimpleNamespace(buffer=io.BytesIO(json.dumps(SAMPLE).encode()))),
              patch.object(hook.subprocess, "run") as run):
            hook.main()
        self.assertEqual(run.call_args.args[0], ["hc", "label", "t16", f"codex.cache.usage={SESSION}:1000:750"])

    def test_ignores_inapplicable_or_invalid_usage(self):
        for update in (
            {"thread_id": "another-thread"}, {"status": "failed"}, {"kind": "ForegroundCompaction"},
            {"session_id": "../"}, {"token_usage": None}, {"token_usage": {"input_tokens": 100}},
            {"token_usage": {"input_tokens": True, "cached_input_tokens": 0}},
            {"token_usage": {"input_tokens": 100, "cached_input_tokens": 101}},
        ):
            with self.subTest(update=update):
                self.assertEqual(hook.labels_for({**SAMPLE, **update}), [])
        self.assertEqual(hook.labels_for({**SAMPLE, "token_usage": {"input_tokens": 100, "cached_input_tokens": 0}}),
                         [f"codex.cache.usage={SESSION}:100:0"])
