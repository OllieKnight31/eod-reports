#!/usr/bin/env python3
"""
Package this skill as a zip to hand to someone else.

  python3 package.py                         # → ./eod-system-skill.zip
  python3 package.py --out ~/Desktop/eod-system-skill.zip
  python3 package.py --refresh-from ~/code/EOD-system   # re-bundle the template first

The recipient unzips it into ~/.claude/skills/ (so the folder is ~/.claude/skills/eod-system)
and asks Claude to "set up the EOD system for my business".

The zip never contains a business's config: client.env, .env files, saved settings,
node_modules, .git and .vercel are all left out.
"""
import argparse
import shutil
import sys
import zipfile
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
SKIP = {"node_modules", ".vercel", ".DS_Store", ".data", ".git", "client.env", "__pycache__", ".cache", ".work"}


def excluded(path: Path) -> bool:
    for part in path.parts:
        if part in SKIP or (part.startswith(".env") and part != ".env.example"):
            return True
    return path.suffix == ".zip"


def main() -> int:
    p = argparse.ArgumentParser(description="Zip the eod-system skill for sharing.")
    p.add_argument("--out", help="Output zip path (default: ./eod-system-skill.zip)")
    p.add_argument("--refresh-from", help="Replace the bundled template with this folder before zipping")
    args = p.parse_args()

    if args.refresh_from:
        src = Path(args.refresh_from).expanduser().resolve()
        if not (src / "package.json").exists():
            print(f"ERROR: {src} does not look like the EOD System template", file=sys.stderr)
            return 1
        tpl = SKILL / "template"
        if tpl.exists():
            shutil.rmtree(tpl)
        shutil.copytree(src, tpl, ignore=lambda d, names: [n for n in names if excluded(Path(n))])
        print(f"Template refreshed from {src}")

    out = Path(args.out).expanduser().resolve() if args.out else Path.cwd() / "eod-system-skill.zip"
    out.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(SKILL.rglob("*")):
            rel = f.relative_to(SKILL)
            if f.is_dir() or excluded(rel):
                continue
            z.write(f, Path("eod-system") / rel)
            count += 1
    print(f"{out}  ({count} files, {out.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
