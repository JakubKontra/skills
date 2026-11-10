"""Measure every mesh object in a Blender scene and report sizes in millimetres as JSON.

Headless:  blender -b model.blend --python scripts/blender/measure.py -- [report.json]
Live scene (Blender MCP): run this file's code, then call measure() and read the returned dict.

For each mesh object it reports the world-space bounding box (after modifiers) and the
dimensions along the object's own local axes. Objects built by build_panels.py carry
diy_finished_mm / diy_thickness_mm; those are compared against the measured local dimensions,
and any difference above 0.01 mm, or a non-unit object scale, is listed under "problems".
Overlapping parts are reported as clashes. Assemblies get an overall world bounding box.
"""
import json
import sys

import bpy
from mathutils import Vector

TOLERANCE_MM = 0.01


def r(value):
    return round(value * 1000, 3)  # metres -> mm


def measure(out_path=None):
    scale = bpy.context.scene.unit_settings.scale_length or 1.0
    depsgraph = bpy.context.evaluated_depsgraph_get()
    objects, assemblies, problems = [], {}, []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        ev = obj.evaluated_get(depsgraph)
        corners = [ev.matrix_world @ Vector(c) for c in ev.bound_box]
        lo = [min(c[i] for c in corners) * scale for i in range(3)]
        hi = [max(c[i] for c in corners) * scale for i in range(3)]
        local = [(max(c[i] for c in ev.bound_box) - min(c[i] for c in ev.bound_box)) * scale
                 for i in range(3)]
        obj_scale = list(obj.matrix_world.to_scale())
        entry = dict(name=obj.name, world_min_mm=[r(v) for v in lo], world_max_mm=[r(v) for v in hi],
                     world_size_mm=[r(b - a) for a, b in zip(lo, hi)],
                     local_size_mm=[r(v * s) for v, s in zip(local, obj_scale)])
        if any(abs(abs(s) - 1) > 1e-6 for s in obj_scale):
            entry["scale"] = [round(s, 6) for s in obj_scale]
            problems.append(f"{obj.name}: object scale {entry['scale']} is not applied")
        if "diy_part" in obj:
            fx, fy = obj["diy_finished_mm"]
            expected = [float(fx), float(fy), float(obj["diy_thickness_mm"])]
            entry.update(part=obj["diy_part"], instance=obj["diy_instance"],
                         assembly=obj["diy_assembly"], expected_mm=expected)
            diff = [abs(a - b) for a, b in zip(entry["local_size_mm"], expected)]
            entry["ok"] = max(diff) <= TOLERANCE_MM
            if not entry["ok"]:
                problems.append(f"{obj.name}: local size {entry['local_size_mm']} != expected {expected}")
            box = assemblies.setdefault(obj["diy_assembly"], [list(lo), list(hi)])
            box[0] = [min(a, b) for a, b in zip(box[0], lo)]
            box[1] = [max(a, b) for a, b in zip(box[1], hi)]
        objects.append(entry)
    # Interference: placed parts are axis-aligned boxes, so overlapping world boxes are real clashes.
    parts = [o for o in objects if "part" in o]
    for i, a in enumerate(parts):
        for b in parts[i + 1:]:
            overlap = [min(a["world_max_mm"][k], b["world_max_mm"][k]) -
                       max(a["world_min_mm"][k], b["world_min_mm"][k]) for k in range(3)]
            if min(overlap) > TOLERANCE_MM:
                problems.append(f"{a['name']} and {b['name']} overlap by {[round(v, 3) for v in overlap]} mm")
    report = dict(units="mm", objects=objects, problems=problems,
                  assemblies={k: dict(world_min_mm=[r(v) for v in lo], world_max_mm=[r(v) for v in hi],
                                      size_mm=[r(b - a) for a, b in zip(lo, hi)])
                              for k, (lo, hi) in assemblies.items()})
    text = json.dumps(report, indent=2)
    if out_path:
        with open(out_path, "w", encoding="utf-8") as out:
            out.write(text + "\n")
    print(f"diy-works: measured {len(objects)} objects, {len(problems)} problem(s)")
    return report


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    measure(argv[0] if argv else None)
