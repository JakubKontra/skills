"""Generate workshop files from one parts.json project file. All dimensions are millimetres.

Writes into OUTPUT_DIR:
  bom.csv           bill of materials, one row per part type, with blank sizes and edges
  edge-banding.csv  banding length per edge code (finished edge length x quantity)
  drilling.csv      one row per hole, in the part's local axes
  labels.csv        one row per physical part instance, for printing part labels
  narez-job.json    input for scripts/narez.py, with total quantities

Blank sizes come from the same code as narez.py, so the BOM and the cutting plan always agree.
Standard library only.
"""
import argparse
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import narez  # noqa: E402  (shared validation and blank-size calculation)

AXES = {"+x": (1, 0, 0), "-x": (-1, 0, 0), "+y": (0, 1, 0), "-y": (0, -1, 0),
        "+z": (0, 0, 1), "-z": (0, 0, -1)}
JOB_KEYS = ("id", "stock", "finished_mm", "grain", "allow_rotate", "edges", "extra_blank_mm")
GRAIN_ARROW = {"x": "→ (along X)", "y": "↑ (along Y)", "none": "none"}


def fail(message):
    raise ValueError(message)


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def placement_axes(place, pid):
    x_axis, y_axis = place.get("x_axis", "+x"), place.get("y_axis", "+y")
    if x_axis not in AXES or y_axis not in AXES:
        fail(f"{pid}: x_axis and y_axis must be one of {', '.join(AXES)}")
    normal = cross(AXES[x_axis], AXES[y_axis])
    if normal == (0, 0, 0):
        fail(f"{pid}: x_axis and y_axis must be perpendicular")
    return AXES[x_axis], AXES[y_axis], normal


def load(data):
    """Validate a project and return (project, assemblies, parts) with totals resolved."""
    if data.get("units", "mm") != "mm":
        fail("units must be mm")
    assemblies = {}
    for a in data.get("assemblies") or [{"id": "MAIN", "qty": 1}]:
        aid = narez.label(a["id"])
        if aid in assemblies:
            fail(f"Duplicate assembly ID: {aid}")
        offsets = a.get("offsets_mm")
        qty = narez.quantity(a.get("qty", 1))
        if offsets is not None and (len(offsets) != qty or any(len(o) != 3 for o in offsets)):
            fail(f"{aid}: offsets_mm needs one [x, y, z] per assembly instance")
        assemblies[aid] = dict(a, id=aid, qty=qty, name=a.get("name", aid))
    parts = []
    for raw in data["parts"]:
        pid = narez.label(raw["id"])
        aid = raw.get("assembly", next(iter(assemblies)))
        if aid not in assemblies:
            fail(f"{pid}: unknown assembly {aid!r}")
        per_assembly = narez.quantity(raw["qty"])
        stock = data["stocks"].get(raw["stock"]) or fail(f"{pid}: unknown stock {raw['stock']!r}")
        fx, fy = narez.dims(raw["finished_mm"], 2, True)
        thickness = narez.length(stock["thickness_mm"], True)
        for hole in raw.get("drilling", []):
            x, y = narez.length(hole["x_mm"]), narez.length(hole["y_mm"])
            d, depth = narez.length(hole["d_mm"], True), narez.length(hole["depth_mm"], True)
            if not (0 <= x <= fx and 0 <= y <= fy):
                fail(f"{pid}: hole at {hole['x_mm']},{hole['y_mm']} lies outside the finished part")
            if depth > thickness:
                fail(f"{pid}: hole depth {hole['depth_mm']} exceeds the part thickness")
            if hole.get("face", "A") not in ("A", "B", "x-", "x+", "y-", "y+"):
                fail(f"{pid}: hole face must be A, B or an edge (x-, x+, y-, y+)")
        places = raw.get("placements")
        if places is not None:
            if len(places) != per_assembly:
                fail(f"{pid}: placements needs one entry per part in the assembly ({per_assembly})")
            for place in places:
                placement_axes(place, pid)
                if len(place.get("at_mm", [])) != 3:
                    fail(f"{pid}: each placement needs at_mm [x, y, z]")
        parts.append(dict(raw, id=pid, assembly=aid, qty_per_assembly=per_assembly,
                          qty_total=per_assembly * assemblies[aid]["qty"],
                          name=raw.get("name", pid), thickness=thickness))
    return data, assemblies, parts


def narez_job(data, parts):
    job_parts = []
    for p in parts:
        entry = {k: p[k] for k in JOB_KEYS if k in p}
        entry["qty"] = p["qty_total"]
        job_parts.append(entry)
    return dict(kerf_mm=data["kerf_mm"], stocks=data["stocks"],
                edge_types={k: dict(band_mm=v["band_mm"], premill_mm=v["premill_mm"])
                            for k, v in data["edge_types"].items()},
                parts=job_parts)


def build(data):
    data, assemblies, parts = load(data)
    job = narez_job(data, parts)
    _, _, rows, _ = narez.read_job(job)  # validates stock, grain, edges and computes blanks
    blanks = {r["id"]: r for r in rows}
    project, revision = data.get("project", ""), data.get("revision", "")

    bom, drilling, labels, banding = [], [], [], {}
    for p in parts:
        r, edges = blanks[p["id"]], p.get("edges", {})
        fx, fy = p["finished_mm"]
        bom.append(dict(project=project, revision=revision, assembly=p["assembly"], part=p["id"],
                        name=p["name"], qty_per_assembly=p["qty_per_assembly"], qty=p["qty_total"],
                        stock=p["stock"], thickness_mm=r["thickness_mm"], finished_x=r["finished_x"],
                        finished_y=r["finished_y"], blank_x=r["blank_x"], blank_y=r["blank_y"],
                        grain=r["grain"], **{f"edge_{s}": edges.get(s, "") for s in narez.SIDES},
                        holes=len(p.get("drilling", [])), notes=p.get("notes", "")))
        for side, code in edges.items():
            edge_len = fy if side[0] == "x" else fx
            entry = banding.setdefault(code, dict(edge_code=code, pieces=0, length_mm=0))
            entry["pieces"] += p["qty_total"]
            entry["length_mm"] += edge_len * p["qty_total"]
        for i, hole in enumerate(p.get("drilling", []), 1):
            depth = hole["depth_mm"]
            drilling.append(dict(assembly=p["assembly"], part=p["id"], qty=p["qty_total"], hole=i,
                                 face=hole.get("face", "A"), x_mm=hole["x_mm"], y_mm=hole["y_mm"],
                                 d_mm=hole["d_mm"], depth_mm=depth,
                                 through="yes" if narez.length(depth) == p["thickness"] else "no",
                                 note=hole.get("note", "")))
        for n in range(1, p["qty_total"] + 1):
            labels.append(dict(project=project, revision=revision, assembly=p["assembly"],
                               part=p["id"], instance=f"{n}/{p['qty_total']}", name=p["name"],
                               finished=f"{fx} × {fy} × {r['thickness_mm']}", stock=p["stock"],
                               grain=GRAIN_ARROW[r["grain"]],
                               edges=" ".join(f"{s}:{c}" for s, c in sorted(edges.items())) or "-",
                               face="A up"))
    for entry in banding.values():
        entry["length_m"] = round(entry.pop("length_mm") / 1000, 3)
    return dict(bom=bom, drilling=drilling, labels=labels,
                banding=sorted(banding.values(), key=lambda e: e["edge_code"]), job=job)


def write_csv(path, rows, fields=None):
    with open(path, "w", encoding="utf-8", newline="") as out:
        writer = csv.DictWriter(out, fieldnames=fields or list(rows[0]), delimiter=";")
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("project", type=Path, help="parts.json")
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    try:
        result = build(json.loads(args.project.read_text(encoding="utf-8-sig")))
        args.output_dir.mkdir(parents=True, exist_ok=True)
        write_csv(args.output_dir / "bom.csv", result["bom"])
        write_csv(args.output_dir / "edge-banding.csv", result["banding"],
                  ["edge_code", "pieces", "length_m"])
        write_csv(args.output_dir / "drilling.csv", result["drilling"],
                  ["assembly", "part", "qty", "hole", "face", "x_mm", "y_mm", "d_mm", "depth_mm",
                   "through", "note"])
        write_csv(args.output_dir / "labels.csv", result["labels"])
        (args.output_dir / "narez-job.json").write_text(
            json.dumps(result["job"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except (ValueError, KeyError, TypeError, OSError) as exc:
        parser.exit(1, f"BOM error: {exc}\n")
    print(f"Wrote bom.csv, edge-banding.csv, drilling.csv, labels.csv, narez-job.json to {args.output_dir}")


if __name__ == "__main__":
    main()
