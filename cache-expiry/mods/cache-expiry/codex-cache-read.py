#!/usr/bin/env python3
"""Read cache counts from rollouts held open by the current local Codex processes."""

import json
from pathlib import Path
import re
import subprocess
import sys

TERMINAL = re.compile(r"t[a-z0-9]{1,32}")
SESSION = re.compile(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}", re.I)
MAX_TAIL = 512 * 1024


def command(*argv):
    try:
        return subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True,
                              text=True, timeout=2, check=True).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def rollout_paths(fields, sessions):
    paths = {}
    pid = ""
    for field in fields.splitlines():
        if field.startswith("p"):
            pid = field[1:]
        if pid and field.startswith("n"):
            path = Path(field[1:])
            if path.is_relative_to(sessions) and path.match("rollout-*.jsonl"):
                paths.setdefault(pid, set()).add(path)
    return paths


def last_usage(path, sessions):
    try:
        path = path.resolve(strict=True)
        if not path.is_relative_to(sessions) or not path.is_file():
            return None
        with path.open("rb") as stream:
            start = json.loads(stream.readline(64 * 1024))
            if not isinstance(start, dict) or start.get("type") != "session_meta":
                return None
            meta = start.get("payload")
            session = meta.get("id") if isinstance(meta, dict) else None
            if (not isinstance(session, str) or not SESSION.fullmatch(session)
                    or meta.get("session_id") != session or not path.name.endswith(f"-{session}.jsonl")):
                return None
            end = stream.seek(0, 2)
            stream.seek(max(0, end - MAX_TAIL))
            rows = stream.read(MAX_TAIL).split(b"\n")
    except (OSError, ValueError):
        return None
    if end > MAX_TAIL:
        rows = rows[1:]
    for row in reversed(rows):
        if b'"token_count"' not in row:
            continue
        try:
            event = json.loads(row)
        except ValueError:
            continue
        payload = event.get("payload") if isinstance(event, dict) and event.get("type") == "event_msg" else None
        info = payload.get("info") if isinstance(payload, dict) and payload.get("type") == "token_count" else None
        usage = info.get("last_token_usage") if isinstance(info, dict) else None
        if isinstance(usage, dict):
            total, cached = usage.get("input_tokens"), usage.get("cached_input_tokens")
            if type(total) is int and type(cached) is int and 0 < total < 2**53 and 0 <= cached <= total:
                return {"input": total, "cached": cached}
    return None


def main(addresses):
    sessions = (Path.home() / ".codex/sessions").resolve()
    foreground = {}
    for address in addresses:
        if not TERMINAL.fullmatch(address):
            continue
        try:
            terminal = json.loads(command("hc", "get", address, "--json"))
            process = terminal.get("foreground") or {}
            pid = process.get("pid")
            if (type(pid) is int and pid > 0 and process.get("name") == "codex"
                    and (terminal.get("status") or {}).get("app") == "codex"):
                foreground[address] = str(pid)
        except (AttributeError, ValueError):
            continue
    if not foreground:
        return {}
    paths = rollout_paths(command("lsof", "-a", "-p", ",".join(foreground.values()), "-Fn"), sessions)
    samples = {}
    for address, pid in foreground.items():
        candidates = paths.get(pid, ())
        if len(candidates) == 1:
            usage = last_usage(next(iter(candidates)), sessions)
            if usage is not None:
                samples[address] = usage
    return samples


if __name__ == "__main__":
    print(json.dumps(main(sys.argv[1:])))
