#!/bin/bash
# Installs the eod-system skill for Claude Code.
#
#   ./install.sh            first install: copies skill/ to ~/.claude/skills/eod-system
#   ./install.sh --update   replace an existing install with this version. The old copy is
#                           moved to ~/.claude/skill-backups/ first, and any configuration
#                           found inside it (client.env, .env files, .data, .vercel) is put
#                           back untouched.
#
# It never overwrites configuration, never touches your EOD projects (they live wherever you
# created them, not in the skill folder), and never needs a password or a key.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/skill"
SKILLS_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
DEST="$SKILLS_DIR/eod-system"
UPDATE=0
for a in "$@"; do
  case "$a" in
    --update) UPDATE=1 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $a (use --update or --help)" >&2; exit 2 ;;
  esac
done

# The download must be complete: the skill is no use without the app template it deploys.
for f in SKILL.md scripts/bootstrap.py template/package.json template/api/index.js template/scripts/configure.js; do
  if [ ! -f "$SRC/$f" ]; then
    echo "This download is incomplete: skill/$f is missing. Download it again and re-run." >&2
    exit 1
  fi
done

# Copy the skill, leaving out anything that is machine-specific or holds settings.
copy_skill() {
  mkdir -p "$DEST"
  (cd "$SRC" && find . \
      \( -name node_modules -o -name .git -o -name .vercel -o -name .data -o -name __pycache__ -o -name .DS_Store \) -prune -o \
      -type f ! -name client.env ! -name .env ! -name '.env.*' -print; \
    cd "$SRC" && find . -type f -name .env.example -print) | sort -u | while IFS= read -r f; do
    mkdir -p "$DEST/$(dirname "$f")"
    cp "$SRC/$f" "$DEST/$f"
  done
}

if [ -e "$DEST" ]; then
  if [ "$UPDATE" -ne 1 ]; then
    echo "eod-system is already installed at $DEST. Nothing was changed."
    echo "To replace it with this version (the old copy is backed up first): ./install.sh --update"
    exit 1
  fi
  BACKUP_DIR="$(dirname "$SKILLS_DIR")/skill-backups"
  BACKUP="$BACKUP_DIR/eod-system-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BACKUP_DIR"
  mv "$DEST" "$BACKUP"
  copy_skill
  # Put back any configuration that was sitting inside the old copy. Never overwrite.
  (cd "$BACKUP" && find . \( -name node_modules -o -name .git \) -prune -o \
      \( -name client.env -o -name .env -o -name '.env.*' -o -path '*/.data/*' -o -path '*/.vercel/*' \) -type f ! -name .env.example -print) | while IFS= read -r f; do
    if [ ! -e "$DEST/$f" ]; then
      mkdir -p "$DEST/$(dirname "$f")"
      cp -p "$BACKUP/$f" "$DEST/$f"
      echo "Kept your existing ${f#./}"
    fi
  done
  echo "Updated $DEST"
  echo "The previous version is in $BACKUP"
else
  copy_skill
  echo "Installed to $DEST"
fi

# Friendly checks. None of these stops the install.
note() { echo "  note: $*"; }
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$major" -ge 18 ] 2>/dev/null || note "Node.js 18 or newer is needed (found $(node --version 2>/dev/null)). Get it from https://nodejs.org"
else
  note "Node.js is not installed. Get version 20 or 22 from https://nodejs.org"
fi
command -v python3 >/dev/null 2>&1 || note "python3 is not installed. On a Mac run: xcode-select --install"
command -v vercel >/dev/null 2>&1 || note "The Vercel CLI is not installed. Once Node is in place run: npm i -g vercel"

echo
echo "Next: restart Claude Code, then say:  set up the EOD system for my business"
