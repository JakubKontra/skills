"""Check which tools and Python packages the diy-works skill can use on this machine.

Standard library only. Prints a table (or JSON with --json) with each dependency's status,
the stages it unlocks, and the command that installs it. The exit code is 1 when something
needed by the requested --stage is missing, otherwise 0.

Python packages may live in the skill's own virtual environment (default ~/.venvs/diy-works,
override with DIY_WORKS_VENV). The report then says which interpreter to run the scripts with.
--install creates that venv and installs shapely and ezdxf into it. Only use it after the user
has agreed. Blender and the DWG converter are never installed automatically.
"""
import argparse
import importlib.util
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import sysconfig
from pathlib import Path

STAGES = ("all", "2d", "3d", "clearance", "cutting", "dwg")
PACKAGES = ("shapely", "ezdxf")
MAC = platform.system() == "Darwin"
WINDOWS = platform.system() == "Windows"
VENV = Path(os.environ.get("DIY_WORKS_VENV", Path.home() / ".venvs" / "diy-works")).expanduser()
VENV_PY = VENV / ("Scripts/python.exe" if WINDOWS else "bin/python")


def in_venv():
    return sys.prefix != getattr(sys, "base_prefix", sys.prefix)


def externally_managed():
    return not in_venv() and (Path(sysconfig.get_path("stdlib")) / "EXTERNALLY-MANAGED").exists()


def pip(package):
    if externally_managed() or VENV_PY.exists():
        # Homebrew/Debian Python refuses a global pip install (PEP 668): use the skill's venv.
        return (f"python3 scripts/check_env.py --install   (creates {VENV} and installs {package}; "
                f"then run the scripts with {VENV_PY})")
    return f"{Path(sys.executable).name} -m pip install {package}"


def module(name):
    if importlib.util.find_spec(name) is None:
        return None
    try:
        mod = __import__(name)
    except Exception:  # installed but broken, e.g. missing native library
        return None
    return getattr(mod, "__version__", "installed")


def venv_module(name):
    """Version of a package inside the skill venv, when we are not already running there."""
    if not VENV_PY.exists() or Path(sys.prefix).resolve() == VENV.resolve():
        return None
    code = f"import {name}; print(getattr({name}, '__version__', 'installed'))"
    try:
        done = subprocess.run([str(VENV_PY), "-I", "-c", code], capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return None
    return done.stdout.strip() if done.returncode == 0 else None


def package(name):
    here = module(name)
    if here:
        return True, here
    there = venv_module(name)
    if there:
        return True, f"{there} in {VENV} (run the scripts with {VENV_PY})"
    return False, "not installed"


def binary(names, extra_paths=()):
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    for path in extra_paths:
        if Path(path).exists():
            return path
    return None


def blender_version(path):
    try:
        done = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return None
    match = re.search(r"Blender (\d+)\.(\d+)(?:\.(\d+))?", done.stdout)
    return tuple(int(g or 0) for g in match.groups()) if match else None


def blender_hint():
    if MAC:
        return "brew install --cask blender   (or download from https://www.blender.org/download/)"
    if WINDOWS:
        return "winget install BlenderFoundation.Blender   (or https://www.blender.org/download/)"
    return "sudo snap install blender --classic   (or https://www.blender.org/download/)"


def oda_hint():
    return "Download ODA File Converter from https://www.opendesign.com/guestfiles/oda_file_converter" + (
        "   (or brew install libredwg for dwg2dxf)" if MAC else "   (or install libredwg for dwg2dxf)")


def checks(probe_blender=True):
    shapely_ok, shapely = package("shapely")
    ezdxf_ok, ezdxf = package("ezdxf")
    blender = binary(["blender"], [
        "/Applications/Blender.app/Contents/MacOS/Blender",
        str(Path.home() / "Applications/Blender.app/Contents/MacOS/Blender"),
    ])
    blender_ok, blender_detail = bool(blender), blender or "not found"
    if blender and probe_blender:
        version = blender_version(blender)
        if version:
            blender_detail = f"{'.'.join(map(str, version))} at {blender}"
            if version < (2, 80, 0):
                blender_ok, blender_detail = False, blender_detail + " (too old: 2.80+ required)"
    dwg = binary(["ODAFileConverter", "dwg2dxf", "dxf2dwg"], [
        "/Applications/ODAFileConverter.app/Contents/MacOS/ODAFileConverter",
    ])
    librecad = binary(["librecad"], ["/Applications/LibreCAD.app/Contents/MacOS/LibreCAD"])
    return [
        dict(name="Python 3.8+", ok=sys.version_info >= (3, 8), detail=platform.python_version(),
             stages=["2d", "3d", "clearance", "cutting", "dwg"], optional=False,
             blocks="every helper script",
             install="Install Python 3.8 or newer from https://www.python.org/downloads/"),
        dict(name="shapely (Python)", ok=shapely_ok, detail=shapely, stages=["clearance"], optional=False,
             blocks="scripts/check_clearance.py (door, drawer and chair clearances)",
             install=pip("shapely")),
        dict(name="ezdxf (Python)", ok=ezdxf_ok, detail=ezdxf, stages=["2d", "cutting"], optional=False,
             blocks="writing/reading DXF drawings and the DXF sheet layout from scripts/narez.py "
                    "(JSON, CSV and SVG cutting plans still work)",
             install=pip("ezdxf")),
        dict(name="Blender", ok=blender_ok, detail=blender_detail, stages=["3d"], optional=False,
             blocks="headless Blender models, scripts/blender/*.py and renders "
                    "(not needed if a Blender MCP server is connected)",
             install=blender_hint()),
        dict(name="DWG converter", ok=bool(dwg), detail=dwg or "not found", stages=["dwg"], optional=False,
             blocks="delivering .dwg files (DXF output still works)", install=oda_hint()),
        dict(name="LibreCAD", ok=bool(librecad), detail=librecad or "not found", stages=["2d"], optional=True,
             blocks="nothing; it is only handy for opening and checking DXF drawings by eye",
             install="brew install --cask librecad" if MAC else "https://librecad.org"),
    ]


def install():
    """Create the skill venv and install the Python packages into it. Returns an exit code."""
    if not VENV_PY.exists():
        print(f"Creating virtual environment {VENV} …")
        VENV.parent.mkdir(parents=True, exist_ok=True)
        done = subprocess.run([sys.executable, "-m", "venv", str(VENV)])
        if done.returncode:
            print("Could not create the virtual environment.", file=sys.stderr)
            return done.returncode
    print(f"Installing {' '.join(PACKAGES)} into {VENV} …")
    done = subprocess.run([str(VENV_PY), "-m", "pip", "install", "--disable-pip-version-check", *PACKAGES])
    if done.returncode:
        print("pip install failed; see the output above.", file=sys.stderr)
        return done.returncode
    print(f"Done. Run the helper scripts with {VENV_PY}\n")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--stage", choices=STAGES, default="all",
                        help="only fail for dependencies this stage needs (default: all, which never fails "
                             "for optional items)")
    parser.add_argument("--json", action="store_true", help="print machine-readable JSON")
    parser.add_argument("--install", action="store_true",
                        help=f"create {VENV} and install {', '.join(PACKAGES)} (ask the user first)")
    parser.add_argument("--no-blender-probe", action="store_true",
                        help="do not start Blender to read its version")
    args = parser.parse_args()

    if args.install and install():
        sys.exit(1)

    items = checks(probe_blender=not args.no_blender_probe)
    for item in items:
        if args.stage == "all":
            item["needed"] = item["name"].startswith("Python")
        else:
            item["needed"] = args.stage in item["stages"] and not item["optional"]
    missing_needed = [i for i in items if i["needed"] and not i["ok"]]
    python = str(VENV_PY) if VENV_PY.exists() and not module("shapely") else sys.executable

    if args.json:
        print(json.dumps(dict(stage=args.stage, ready=not missing_needed, python=python,
                              venv=str(VENV), checks=items), indent=2))
    else:
        print(f"diy-works dependency check (stage: {args.stage})\n")
        for i in items:
            mark = "OK     " if i["ok"] else ("MISSING" if i["needed"] else "absent ")
            print(f"  [{mark}] {i['name']:<18} {i['detail']}")
            if not i["ok"]:
                print(f"            blocks:  {i['blocks']}")
                print(f"            install: {i['install']}")
        print(f"\nRun the helper scripts with: {python}")
        print("Blender MCP: this script cannot see agent tools. The agent should check for a connected "
              "Blender MCP server itself.")
        if missing_needed:
            print("\nNOT READY: install the MISSING items above (ask the user first), "
                  "or continue with stages that do not need them.")
        else:
            print("\nReady for this stage.")
    sys.exit(1 if missing_needed else 0)


if __name__ == "__main__":
    main()
