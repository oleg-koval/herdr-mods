#!/bin/sh
# Installs one or more packs from this repo into Herdr Desktop:
#
#   curl -fsSL https://raw.githubusercontent.com/oleg-koval/herdr-mods/main/install.sh | sh -s cache-expiry
#
# For each pack it copies every folder under <pack>/mods/ into Herdr's mods folder, moving a mod
# that is already there to mod-backups/ first. A pack with a claude-hooks.json also gets those
# Claude Code hooks added to ~/.claude/settings.json (needs jq): a hook already there is left
# alone, and the file is backed up before it changes.
#
# Options:  --list      the packs this repo has
#           --no-hooks  copy the mods only; print the hooks to add by hand
# Env:      HERDR_APP_HOME    Herdr's app folder (default ~/.config/herdr-app)
#           CLAUDE_SETTINGS   Claude settings file (default ~/.claude/settings.json)
#           HERDR_MODS_REF    branch, tag or commit to install from (default main)
#           HERDR_MODS_SRC    a local checkout to install from instead of downloading
set -eu

REPO="oleg-koval/herdr-mods"
REF=${HERDR_MODS_REF:-main}
APP=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
SETTINGS=${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}
STAMP=$(date +%Y%m%d-%H%M%S)
# How hook commands name the app folder: "$HOME/..." for the default one, as the READMEs write it,
# so a hook added by hand earlier is recognised and the settings file stays portable.
# shellcheck disable=SC2016  # the literal $HOME is the point
if [ "$APP" = "$HOME/.config/herdr-app" ]; then APP_REF='$HOME/.config/herdr-app'; else APP_REF=$APP; fi

say() { printf '%s\n' "$*"; }
die() { printf 'herdr-mods: %s\n' "$*" >&2; exit 1; }

hooks=1
list=0
packs=""
for arg in "$@"; do
  case "$arg" in
    --no-hooks) hooks=0 ;;
    --list) list=1 ;;
    -h|--help) sed -n '2,18p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown option: $arg" ;;
    *) printf '%s' "$arg" | grep -Eq '^[a-z0-9][a-z0-9-]*$' || die "not a pack name: $arg"
       packs="$packs $arg" ;;
  esac
done

if [ -n "${HERDR_MODS_SRC:-}" ]; then
  SRC=$HERDR_MODS_SRC
  [ -d "$SRC" ] || die "HERDR_MODS_SRC is not a folder: $SRC"
else
  command -v curl >/dev/null 2>&1 || die "needs curl"
  command -v tar >/dev/null 2>&1 || die "needs tar"
  SRC=$(mktemp -d "${TMPDIR:-/tmp}/herdr-mods.XXXXXX")
  trap 'rm -rf "$SRC"' EXIT
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" | tar -xzf - -C "$SRC" --strip-components 1 \
    || die "couldn't download $REPO at $REF"
fi

available() {
  for dir in "$SRC"/*/mods; do
    [ -d "$dir" ] && basename "$(dirname "$dir")"
  done
}

if [ "$list" = 1 ]; then
  available
  exit 0
fi
[ -n "$packs" ] || die "name a pack to install (--list shows them), e.g. sh -s cache-expiry"
for pack in $packs; do
  [ -d "$SRC/$pack/mods" ] || die "no pack named $pack (packs: $(available | tr '\n' ' '))"
done

# The command lines a pack's claude-hooks.json asks for, as "<event>\t<command>" lines.
hook_lines() {
  jq -r --arg app "$APP_REF" 'to_entries[] | .key as $ev | .value[] | [$ev, gsub("\\{\\{APP\\}\\}"; $app)] | @tsv' "$1"
}

print_hooks() {
  say "  Add these to $SETTINGS by hand, each under \"hooks\" -> <event>:"
  if command -v jq >/dev/null 2>&1; then
    hook_lines "$1" | while IFS="	" read -r ev cmd; do
      say "    $ev: $(jq -cn --arg cmd "$cmd" '{hooks: [{type: "command", command: $cmd}]}')"
    done
  else
    sed 's/^/    /' "$1"
    say "    ({{APP}} is $APP_REF)"
  fi
}

# Adds the pack's hooks to the Claude settings file. A hook already there is kept: the same command,
# reading $HOME or ${HOME} as the home folder.
add_hooks() {
  want=$1
  command -v jq >/dev/null 2>&1 || { say "  jq not found, so no hooks were added."; print_hooks "$want"; return 0; }
  mkdir -p "$(dirname "$SETTINGS")"
  [ -s "$SETTINGS" ] || printf '{}\n' > "$SETTINGS"
  next=$(mktemp "${TMPDIR:-/tmp}/claude-settings.XXXXXX")
  if ! jq --arg app "$APP_REF" --arg home "$HOME" --slurpfile want "$want" '
      def norm: gsub("\\$\\{HOME\\}"; $home) | gsub("\\$HOME"; $home);
      reduce ($want[0] | to_entries[] | .key as $ev | .value[]
              | {ev: $ev, cmd: gsub("\\{\\{APP\\}\\}"; $app)}) as $h (.;
        .hooks[$h.ev] = ((.hooks[$h.ev] // []) as $groups
          | if any($groups[]?.hooks[]?; (.command // "" | norm) == ($h.cmd | norm)) then $groups
            else $groups + [{hooks: [{type: "command", command: $h.cmd}]}] end))' "$SETTINGS" > "$next"; then
    rm -f "$next"
    say "  $SETTINGS isn't valid JSON, so it was left alone."
    print_hooks "$want"
    return 0
  fi
  if cmp -s "$SETTINGS" "$next"; then
    say "  Claude hooks already in $SETTINGS"
  else
    cp "$SETTINGS" "$SETTINGS.bak-$STAMP"
    # Written through, not moved over: a settings file that is a symlink stays one.
    cat "$next" > "$SETTINGS"
    say "  Added Claude hooks to $SETTINGS (backup: $SETTINGS.bak-$STAMP)"
  fi
  rm -f "$next"
}

mkdir -p "$APP/mods"
for pack in $packs; do
  say "$pack"
  for mod in "$SRC/$pack/mods"/*/; do
    name=$(basename "$mod")
    if [ -e "$APP/mods/$name" ]; then
      mkdir -p "$APP/mod-backups"
      mv "$APP/mods/$name" "$APP/mod-backups/$name-$STAMP"
      say "  Replaced mods/$name (old copy: mod-backups/$name-$STAMP)"
    else
      say "  Installed mods/$name"
    fi
    cp -R "$mod" "$APP/mods/$name"
  done
  want="$SRC/$pack/claude-hooks.json"
  if [ -f "$want" ]; then
    if [ "$hooks" = 1 ]; then add_hooks "$want"; else print_hooks "$want"; fi
  fi
  for doc in README.md RECIPE.md; do
    if [ -f "$SRC/$pack/$doc" ]; then say "  Next: https://github.com/$REPO/blob/main/$pack/$doc"; fi
  done
done
say "Done. Restart running Claude sessions (or send each one a prompt) so new hooks apply."
