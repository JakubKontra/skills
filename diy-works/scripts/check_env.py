"""Check which tools and Python packages the diy-works skill can use on this machine.

Standard library only. Prints a table (or JSON with --json) with each dependency's status,
the stages it unlocks, and the command that installs it. The exit code is 1 when something
needed by the requested --stage is missing, otherwise 0.
"""
import argparse
import importlib.util
import json
import platform
import shutil
import sys
import sysconfig
from pathlib import Path

STAGES = ("all", "2d", "3d", "clearance", "cutting", "dwg")
MAC = platform.system() == "Darwin"
WINDOWS = platform.system() == "Windows"


def externally_managed():
    in_venv = sys.prefix != getattr(sys, "base_prefix", sys.prefix)
    return not in_venv and (Path(sysconfig.get_path("stdlib")) / "EXTERNALLY-MANAGED").exists()


def pip(package):
    if externally_managed():
        # Homebrew/Debian Python refuses a global pip install (PEP 668): use a dedicated venv.
        return (f"python3 -m venv ~/.venvs/diy-works && ~/.venvs/diy-works/bin/pip install {package}"
                "   (then run the scripts with ~/.venvs/diy-works/bin/python)")
    return f"{Path(sys.executable).name} -m pip install {package}"


def module(name):
    if importlib.util.find_spec(name) is None:
        return None
    try:
        mod = __import__(name)
    except Exception:  # installed but broken, e.g. missing native library
        return None
    return getattr(mod, "__version__", "installed")


def binary(names, extra_paths=()):
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    for path in extra_paths:
        if Path(path).exists():
            return path
    return None


def blender_hint():
    if MAC:
        return "brew install --cask blender   (or download from https://www.blender.org/download/)"
    if WINDOWS:
        return "winget install BlenderFoundation.Blender   (or https://www.blender.org/download/)"
    return "sudo snap install blender --classic   (or https://www.blender.org/download/)"


def oda_hint():
    return "Download ODA File Converter from https://www.opendesign.com/guestfiles/oda_file_converter" + (
        "   (or brew install libredwg for dwg2dxf)" if MAC else "   (or install libredwg for dwg2dxf)")


def checks():
    py_ok = sys.version_info >= (3, 8)
    shapely = module("shapely")
    ezdxf = module("ezdxf")
    blender = binary(["blender"], [
        "/Applications/Blender.app/Contents/MacOS/Blender",
        str(Path.home() / "Applications/Blender.app/Contents/MacOS/Blender"),
    ])
    dwg = binary(["ODAFileConverter", "dwg2dxf", "dxf2dwg"], [
        "/Applications/ODAFileConverter.app/Contents/MacOS/ODAFileConverter",
    ])
    return [
        dict(name="Python 3.8+", ok=py_ok, detail=platform.python_version(),
             stages=["2d", "3d", "clearance", "cutting", "dwg"],
             blocks="every helper script",
             install="Install Python 3.8 or newer from https://www.python.org/downloads/"),
        dict(name="shapely (Python)", ok=bool(shapely), detail=shapely or "not installed",
             stages=["clearance"], blocks="scripts/check_clearance.py (door, drawer and chair clearances)",
             install=pip("shapely")),
        dict(name="ezdxf (Python)", ok=bool(ezdxf), detail=ezdxf or "not installed",
             stages=["2d", "cutting"],
             blocks="writing/reading DXF drawings and the DXF sheet layout from scripts/narez.py "
                    "(JSON/CSV cutting plans still work)",
             install=pip("ezdxf")),
        dict(name="Blender", ok=bool(blender), detail=blender or "not found",
             stages=["3d"],
             blocks="headless Blender models and renders (not needed if a Blender MCP server is connected)",
             install=blender_hint()),
        dict(name="DWG converter", ok=bool(dwg), detail=dwg or "not found",
             stages=["dwg"], blocks="delivering .dwg files (DXF output still works)",
             install=oda_hint()),
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--stage", choices=STAGES, default="all",
                        help="only fail for dependencies this stage needs (default: all, which never fails "
                             "for optional items)")
    parser.add_argument("--json", action="store_true", help="print machine-readable JSON")
    args = parser.parse_args()

    items = checks()
    for item in items:
        if args.stage == "all":
            item["needed"] = item["name"].startswith("Python")
        else:
            item["needed"] = args.stage in item["stages"]
    missing_needed = [i for i in items if i["needed"] and not i["ok"]]

    if args.json:
        print(json.dumps(dict(stage=args.stage, ready=not missing_needed, checks=items), indent=2))
    else:
        print(f"diy-works dependency check (stage: {args.stage})\n")
        for i in items:
            mark = "OK     " if i["ok"] else ("MISSING" if i["needed"] else "absent ")
            print(f"  [{mark}] {i['name']:<18} {i['detail']}")
            if not i["ok"]:
                print(f"            blocks:  {i['blocks']}")
                print(f"            install: {i['install']}")
        print()
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
