"""Build editable panel objects in Blender from a diy-works parts.json.

Headless:   blender -b --python scripts/blender/build_panels.py -- parts.json out.blend
Live scene (Blender MCP): run this file's code, then call build("/abs/parts.json")
            e.g. exec(open(path).read(), ns := {"__name__": "diy_works"}); ns["build"](parts_path)

1 Blender unit = 1 m; the scene displays millimetres. Every physical part instance becomes one
mesh object whose LOCAL axes are the part's manufacturing axes: local X/Y = finished_mm,
local Z = thickness (face A at local Z = 0). Placement comes from each part's "placements"
(at_mm, x_axis, y_axis) plus the assembly's offsets_mm. Parts without placements are laid out
flat in a row in front of the model. Re-running replaces objects with the same part ID and
instance instead of duplicating them.
"""
import colorsys
import hashlib
import json
import sys

import bpy
from mathutils import Matrix, Vector

AXES = {"+x": (1, 0, 0), "-x": (-1, 0, 0), "+y": (0, 1, 0), "-y": (0, -1, 0),
        "+z": (0, 0, 1), "-z": (0, 0, -1)}
M = 0.001  # millimetres -> Blender units (metres)


def material(stock):
    mat = bpy.data.materials.get(f"diy:{stock}") or bpy.data.materials.new(f"diy:{stock}")
    hue = int(hashlib.md5(stock.encode()).hexdigest()[:4], 16) / 0xFFFF
    r, g, b = colorsys.hsv_to_rgb(hue, 0.35, 0.85)
    mat.diffuse_color = (r, g, b, 1)
    if bpy.app.version < (5, 0, 0):  # node materials are the default from Blender 5
        mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (r, g, b, 1)
    return mat


def collection(name, parent):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        parent.children.link(col)
    return col


def panel_mesh(name, fx, fy, t):
    verts = [(x * M, y * M, z * M) for z in (0, t) for y in (0, fy) for x in (0, fx)]
    faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    return mesh


def placement_matrix(at, x_axis, y_axis, offset):
    x, y = Vector(AXES[x_axis]), Vector(AXES[y_axis])
    z = x.cross(y)
    if z.length == 0:
        raise ValueError(f"x_axis {x_axis} and y_axis {y_axis} must be perpendicular")
    mat = Matrix.Identity(4)
    for row in range(3):
        mat[row][0], mat[row][1], mat[row][2] = x[row], y[row], z[row]
        mat[row][3] = (at[row] + offset[row]) * M
    return mat


def build(parts_path, out_path=None):
    data = json.load(open(parts_path, encoding="utf-8-sig"))
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "MILLIMETERS"
    project = data.get("project", "project")
    root = collection(f"diy:{project}", scene.collection)
    assemblies = {a["id"]: a for a in data.get("assemblies") or [{"id": "MAIN", "qty": 1}]}
    existing = {(o.get("diy_part"), o.get("diy_instance")): o for o in bpy.data.objects
                if o.get("diy_project") == project}
    flat_x, built = 0.0, []
    for part in data["parts"]:
        aid = part.get("assembly", next(iter(assemblies)))
        assembly = assemblies[aid]
        a_qty = assembly.get("qty", 1)
        offsets = assembly.get("offsets_mm") or [[k * 1000.0, 0, 0] for k in range(a_qty)]
        stock = data["stocks"][part["stock"]]
        fx, fy = part["finished_mm"]
        t = stock["thickness_mm"]
        places = part.get("placements")
        for k in range(a_qty):
            col = collection(f"{aid}#{k + 1}" if a_qty > 1 else aid, root)
            for n in range(part["qty"]):
                instance = k * part["qty"] + n + 1
                if places:
                    p = places[n]
                    mat = placement_matrix(p["at_mm"], p.get("x_axis", "+x"), p.get("y_axis", "+y"),
                                           offsets[k])
                else:  # unplaced: lay flat in a row in front of the model (negative Y)
                    mat = placement_matrix([flat_x, -fy - 500, 0], "+x", "+y", [0, 0, 0])
                    flat_x += fx + 50
                name = f"{part['id']}#{instance}"
                old = existing.pop((part["id"], instance), None)
                if old is not None:
                    old_mesh = old.data
                    bpy.data.objects.remove(old, do_unlink=True)
                    if old_mesh.users == 0:
                        bpy.data.meshes.remove(old_mesh)
                obj = bpy.data.objects.new(name, panel_mesh(name, fx, fy, t))
                obj.matrix_world = mat
                obj.data.materials.append(material(part["stock"]))
                obj["diy_project"] = project
                obj["diy_revision"] = data.get("revision", "")
                obj["diy_assembly"] = aid
                obj["diy_part"] = part["id"]
                obj["diy_instance"] = instance
                obj["diy_stock"] = part["stock"]
                obj["diy_grain"] = part.get("grain", "none")
                obj["diy_finished_mm"] = [float(fx), float(fy)]
                obj["diy_thickness_mm"] = float(t)
                col.objects.link(obj)
                built.append(name)
    if out_path:
        bpy.ops.wm.save_as_mainfile(filepath=str(out_path))
    print(f"diy-works: built {len(built)} panel objects" + (f", saved {out_path}" if out_path else ""))
    return built


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not argv:
        sys.exit("usage: blender -b --python build_panels.py -- parts.json [out.blend]")
    build(argv[0], argv[1] if len(argv) > 1 else None)
