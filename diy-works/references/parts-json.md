# One parts file for the whole project

`parts.json` is the single source of truth for a piece of furniture. Write it once the construction is resolved. Generate the BOM, edge banding, drilling, labels, cutting plan and the Blender panel model from it, instead of retyping dimensions into each deliverable. When a dimension changes, edit `parts.json` and regenerate. The [worked example](../examples/skrinka/parts.json) is a complete open cabinet.

It is a superset of the [cutting planner's job](narez.md): `kerf_mm`, `stocks` and `edge_types` mean exactly the same, and each part keeps `id`, `stock`, `finished_mm`, `grain`, `allow_rotate`, `edges` and the optional `extra_blank_mm`.

## Additions

| Key | Meaning |
| --- | --- |
| `project`, `revision`, `notes` | Printed on the BOM and labels. Bump `revision` when anything released changes. |
| `assemblies[]` | `id`, `name`, `qty`, optional `offsets_mm` (one `[x,y,z]` per assembly instance for the 3D model). Part totals = part `qty` × assembly `qty`. Without `assemblies`, everything belongs to one assembly called `MAIN`. |
| `parts[].assembly` | The assembly ID. Part IDs must be unique across the project. Give left- and right-handed parts different IDs when their drilling differs. |
| `parts[].qty` | Quantity **per assembly**. |
| `parts[].name`, `notes` | Human-readable name and workshop notes. |
| `parts[].drilling[]` | Holes in the part's local axes, measured from the X−/Y− datum corner of the **finished** part: `face` (`A` = local Z=0 face, `B` = opposite face, or an edge `x-`, `x+`, `y-`, `y+`), `x_mm`, `y_mm`, `d_mm`, `depth_mm`, `note`. A depth equal to the thickness is a through hole. |
| `parts[].placements[]` | Optional 3D placement, one entry per part in the assembly: `at_mm` is the world position of the local origin (X−/Y− corner of face A), and `x_axis` / `y_axis` (`+x`, `-x`, `+y`, `-y`, `+z`, `-z`) give the world directions of the local axes. Thickness grows along `x_axis × y_axis` (right-handed). |

World axes used by the example: X = width (left → right), Y = depth (front 0 → back), Z = up. A side panel standing on the left with face A towards the interior: `{"at_mm":[18,0,0],"x_axis":"+z","y_axis":"+y"}`. The mirrored right side: `{"at_mm":[582,0,720],"x_axis":"-z","y_axis":"+y"}`.

## Generate the deliverables

```text
python3 scripts/bom.py parts.json out/
python3 scripts/narez.py out/narez-job.json out/plan.json
python3 scripts/narez.py out/narez-job.json out/sheets.svg --format svg
python3 scripts/narez.py out/narez-job.json out/cut-sequence.csv --format cuts
blender -b --python scripts/blender/build_panels.py -- parts.json out/model.blend
blender -b out/model.blend --python scripts/blender/measure.py -- out/measure.json
```

`bom.py` writes `bom.csv`, `edge-banding.csv`, `drilling.csv`, `labels.csv` and `narez-job.json`, using the semicolon separator that Czech Excel opens directly. It validates every hole against the finished outline and board thickness, every placement against the quantity, and computes the blank sizes with the same code as the cutting planner, so the BOM and the cutting plan cannot disagree.

`measure.py` compares each panel's measured local size with `finished_mm` × thickness, flags unapplied object scale, and reports overlapping panels as clashes. Its `assemblies` block gives the overall assembled size to check against the drawing.
