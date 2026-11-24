#!/usr/bin/env python3
"""
EOD System bootstrap.

Copies the template bundled with this skill into a new project folder and runs
`npm install`. Refuses to overwrite an existing folder.

Usage:
  python3 bootstrap.py --name "Acme Coaching"              # → ./acme-coaching-eod
  python3 bootstrap.py --name "Acme Coaching" --dest ~/projects/acme-eod
"""
import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

# The template travels with the skill, so this works on any machine.
TEMPLATE = Path(__file__).resolve().parent.parent / "template"


def slugify(name: str) -> str:
    s = re.sub(r"[^\w\s-]", "", name.strip()).lower()
    s = re.sub(r"[\s_-]+", "-", s)
    return s.strip("-")


def main() -> int:
    p = argparse.ArgumentParser(description="Create a new EOD System project from the bundled template.")
    p.add_argument("--name", "--client", dest="name", required=True, help="Business name (used for the folder name)")
    p.add_argument("--dest", help="Destination folder (default: ./<name>-eod in the current directory)")
    p.add_argument("--no-install", action="store_true", help="Skip `npm install`")
    args = p.parse_args()

    if not (TEMPLATE / "package.json").exists():
        print(f"ERROR: template not found at {TEMPLATE}, the skill folder is incomplete.", file=sys.stderr)
        return 1

    if args.dest:
        dest = Path(args.dest).expanduser().resolve()
    else:
        slug = slugify(args.name)
        if not slug:
            print("ERROR: the name produced an empty folder name", file=sys.stderr)
            return 1
        dest = Path.cwd() / f"{slug}-eod"

    if dest.exists():
        print(f"ERROR: {dest} already exists. Refusing to overwrite, pass --dest or remove it first.", file=sys.stderr)
        return 1

    dest.parent.mkdir(parents=True, exist_ok=True)
    # Never carry real env files, saved settings or a business's config into a new project.
    skip = ("node_modules", ".vercel", ".DS_Store", ".data", ".git", "client.env", ".cache", ".work")
    shutil.copytree(TEMPLATE, dest, ignore=lambda d, names: [
        n for n in names if n in skip or (n.startswith(".env") and n != ".env.example")])
    print(f"Created {dest}")

    if not args.no_install:
        try:
            subprocess.run(["npm", "install", "--no-fund", "--no-audit"], cwd=dest, check=True)
        except FileNotFoundError:
            print("WARN: npm is not installed. Install Node.js 18+ then run `npm install` in the folder.", file=sys.stderr)
        except subprocess.CalledProcessError as e:
            print(f"WARN: npm install failed (exit {e.returncode}). Run it manually.", file=sys.stderr)

    print("\nNext:")
    print(f"  cd {dest}")
    print('  node scripts/configure.js --name "…" --tz … --setters "…" --diallers … --closers "…"')
    print("  npm run dev")
    return 0


if __name__ == "__main__":
    sys.exit(main())
