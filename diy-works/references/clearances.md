# Check a footprint against a fixed obstacle

Use measured outlines from the approved drawing or the projection of the evaluated Blender geometry. The optional helper checks a single moving or fixed subject against a fixed obstacle over overlapping height ranges. Use it for a fridge door near a tree, a drawer near a handle, or a pulled-out chair near a sideboard. For route continuity use the separate [room audit procedure](views-and-variants.md).

## Run a check

Requires Shapely. Run `python3 scripts/check_env.py --stage clearance` first; it reports what is missing and how to install it. Then run from the skill directory:

```text
python scripts/check_clearance.py references/clearance-example.json --output clearance-report.json
```

The [example job](clearance-example.json) is illustrative. Use the project brief, chosen product and actual hardware to determine each required gap. Example thresholds are not recommendations.

- Set `units` to `mm`. In `objects`, give each part an ID, a simple polygon in `outline_mm` using shared world XY coordinates, and its bottom and top elevations in `z_mm`. Include handles, chair backs, or the widest branches at the height that matters. Split a tapered object into height bands when a single footprint would overstate a conflict. Each polygon has one exterior ring. Use separate objects for disconnected components.
- Each check names `subject`, `obstacle`, `required_gap_mm`, and a `motion`. Use `fixed` for a static comparison, `slide` with `delta_mm` for travel from the supplied position, or `hinge` with a real `pivot_mm` and `angles_deg` measured from the supplied geometry. Positive angles are counterclockwise with X to the right and Y up. A closed door pointing downward and a mirrored door may need different signs.
- `pose_resolution_mm` controls the desired bound on unsampled movement between poses. The report gives the actual bound used, including when the planner reaches its sampling cap. It is a numerical setting, independent of the required operating gap.

## Interpret the report

| Status | Meaning |
| --- | --- |
| `clear` | The lower bound on separation meets the requested gap throughout the specified motion and the footprints stay apart. |
| `conflict` | A tested pose touches or intersects the obstacle, or its measured gap is smaller than required. `sample_fraction` locates a witness from the start (0) to the end (1) of the defined travel. |
| `review` | Samples pass, but the motion between them could use up the remaining margin. Refine the resolution or inspect the operation directly in CAD or Blender. |
| `separate_heights` | The supplied vertical ranges do not meet. A horizontal clearance between these two footprints does not constrain them. |

`sampled_gap_mm` is the smallest distance found at tested poses. `lower_gap_mm` accounts for the maximum distance a point can travel to the nearest sample. Report a range when only bounds are known. If a door is partway open, convert its reported fraction back to the angle using the supplied start and end angles.

Contact counts as a conflict for pairs chosen here. Omit intentional mating surfaces. The helper covers rigid translations and rotations about a vertical axis. For two moving objects, specify the obstacle in the actual operating state of interest and test the relevant combinations. For a drop-down oven door, tilted window, or other out-of-plane motion, check the swept 3D geometry or an appropriate section. This check alone cannot establish walkway connectivity, vertical clearances, or suitability for installation.
