#!/usr/bin/env python3
"""Put a Codex terminal's observed cache counts in its local Herdr labels."""

import json
import os
import re
import subprocess
import sys
import time

SESSION = re.compile(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}", re.I)
TERMINAL = re.compile(r"t[a-z0-9]{1,32}")
MAX_SAFE_INTEGER = (1 << 53) - 1


def labels_for(payload, now_ms=None):
    if not isinstance(payload, dict):
        return []
    session = payload.get("session_id")
    if not isinstance(session, str) or not SESSION.fullmatch(session):
        return []
    event = payload.get("hook_event_name")
    if event == "SessionStart":
        return [f"codex.cache.session={session}", "codex.cache.usage="]
    if (event != "PostModelRequest" or payload.get("thread_id") != session
            or payload.get("kind") not in ("Sampling", "sampling")
            or payload.get("status") != "completed"):
        return []
    usage = payload.get("token_usage")
    if not isinstance(usage, dict):
        return []
    input_tokens, cached_tokens = usage.get("input_tokens"), usage.get("cached_input_tokens")
    if (type(input_tokens) is not int or type(cached_tokens) is not int
            or not 0 <= cached_tokens <= input_tokens <= MAX_SAFE_INTEGER or input_tokens == 0):
        return []
    # The request's end time (ms) lets the mod count it against OpenAI's cache lifetime.
    at = int(time.time() * 1000) if now_ms is None else now_ms
    return [f"codex.cache.usage={session}:{input_tokens}:{cached_tokens}:{at}"]


def main():
    terminal = os.environ.get("HC_TERMINAL_ID", "")
    if not TERMINAL.fullmatch(terminal):
        return
    try:
        raw = sys.stdin.buffer.read(65_537)
        if len(raw) > 65_536:
            return
        updates = labels_for(json.loads(raw))
        if updates:
            subprocess.run(
                ["hc", "label", terminal, *updates],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2, check=False,
            )
    except (OSError, ValueError, subprocess.SubprocessError):
        return


if __name__ == "__main__":
    main()
