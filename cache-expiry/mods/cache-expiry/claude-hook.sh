#!/bin/bash
# Claude Code SessionStart + UserPromptSubmit hook for Claude running in herdr-core. Never blocks.
#
# 1. Labels the terminal with its conversation (claude.session, claude.profile), so claude-revive
#    can resume it after a reboot: herdr-core gives a lost terminal a shell and never re-runs it.
# 2. Writes ~/.local/state/herdr-idle/<terminal> = transcript path, so the agent-brief mod can
#    warn about an expired prompt cache when you switch to that terminal, before you type.
#
# No-op outside herdr-core and in headless `claude -p` runs. Fails open: any missing tool exits 0.
set -u
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

term=${HC_TERMINAL_ID:-}
[[ "$term" =~ ^t[a-z0-9]{1,32}$ ]] || exit 0
[ "${CLAUDE_CODE_ENTRYPOINT:-cli}" = cli ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
hc=$(command -v hc 2>/dev/null || echo "$HOME/.local/bin/herdr-core")
[ -x "$hc" ] || exit 0

input=$(cat)
id=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null) || exit 0
tp=$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null) || exit 0
[ -n "$id" ] || exit 0

state="$HOME/.local/state/herdr-idle"
mkdir -p "$state" 2>/dev/null || exit 0
[ -z "$tp" ] || printf '%s' "$tp" > "$state/$term" 2>/dev/null

# label only on change: a prompt that resumes the same conversation costs no hc call
want="$id|${CLAUDE_CONFIG_DIR:-}"
[ "$(cat "$state/$term.label" 2>/dev/null)" = "$want" ] && exit 0
labels=("claude.session=$id")
[ -z "${CLAUDE_CONFIG_DIR:-}" ] || labels+=("claude.profile=$CLAUDE_CONFIG_DIR")
"$hc" label "$term" "${labels[@]}" >/dev/null 2>&1 && printf '%s' "$want" > "$state/$term.label"
exit 0
