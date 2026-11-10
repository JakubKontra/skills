"""Shared paths and helpers for the diy-works tests (stdlib unittest)."""
import importlib.util
import os
import subprocess
import sys
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
SCRIPTS = SKILL / "scripts"
REFS = SKILL / "references"
EXAMPLE = SKILL / "examples" / "skrinka"
sys.path.insert(0, str(SCRIPTS))


def has(module):
    return importlib.util.find_spec(module) is not None


def run(script, *args, env=None):
    """Run a helper script with the current interpreter and return the CompletedProcess."""
    return subprocess.run([sys.executable, str(SCRIPTS / script), *map(str, args)],
                          capture_output=True, text=True, env={**os.environ, **(env or {})})
