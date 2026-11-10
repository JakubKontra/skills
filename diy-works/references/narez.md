# Cutting rectangular parts from sheet stock

**Requirements:** run `python3 scripts/check_env.py --stage cutting` first; it reports missing packages and how to install them.

The planner at `scripts/narez.py` needs only the Python 3.8+ standard library for JSON and CSV. To export an editable DXF sheet layout, use a Python environment with `ezdxf` installed. The commands below start in the skill's root directory. The output directory must already exist. The [sample job](priklad-skrinka.json) describes the four panels of an open cabinet measuring 600 × 400 × 720 mm. Its trim allowances, kerf, and edge-banding settings are specific to the example.

```text
python scripts/narez.py references/priklad-skrinka.json plan.json
python scripts/narez.py references/priklad-skrinka.json cut-list.csv --format cutlist
python scripts/narez.py references/priklad-skrinka.json cut-sequence.csv --format cuts
python scripts/narez.py references/priklad-skrinka.json sheet-layout.dxf --format dxf
```

## Inputs

- `kerf_mm` is the measured width of the saw cut for this job. Give dimensions in millimetres with up to three decimal places. Use the workshop's tolerances when specifying machining allowances.
- Give each distinct combination of material, thickness, finish, reference face, and sheet size its own key in `stocks`. Set `size_mm` to the raw sheet dimensions [X,Y], `thickness_mm` to its thickness, `qty` to the number of identical sheets available, and `grain` to `x`, `y`, or `none`. Enter four total edge trims in `trim_mm` in the order X−, X+, Y−, Y+. Each trim includes the saw kerf. Enter zero for an edge that is already clean. Give a different sheet format or a specific offcut its own stock key and assign parts to it.
- In `edge_types`, each banding code has a `band_mm` value for the actual build-up from the applied band and a `premill_mm` value for material removed before banding. In the example, a finished depth of 400 mm with one banded edge requires a 398.5 mm blank. Pre-milling removes 0.5 mm and the band adds 2 mm.
- For each part type, provide a unique `id`, its `stock` key, quantity `qty`, finished dimensions `finished_mm` [X,Y], edge codes in `edges` (for example `{"y-":"ABS2"}`, or `{}` for an unbanded part), the grain direction in the part's **local axes** in `grain`, and an explicit boolean `allow_rotate`. An omitted edge has zero build-up. Optional `extra_blank_mm` [X,Y] adds a total oversize allowance on each axis for subsequent machining. Specify separately which edge will be trimmed.
- For directional grain, specify the required axis. Use `none` for a part with no directional requirement. Permitting rotation allows a quarter turn in the plane with the same face up. The planner keeps every part face up and preserves its handedness.

## Read and hand over the results

1. The JSON contains `cutlist` with finished and blank dimensions, `sheets` with stock and sheet records, the full sequence in `cuts`, individual part instances in `parts`, and leftover rectangles in `remnants`. Coordinates are measured from the X−/Y− corner of the original raw sheet, always viewed from the same face. Workpiece IDs in `source`, `low`, and `high` are local to each sheet. Its initial workpiece is `0`.
2. A cut with `axis=x` separates a strip measuring `low_mm` along X from the X− edge of the specified workpiece. Measure to the near edge of the cut. The blade removes `kerf_mm` towards increasing X, and the remaining piece on that side receives the `high` ID. For Y, measure from the Y− edge. The sequence includes the sheet trims. An empty output ID means that side has no material left. A workpiece that already matches the required blank needs no further cut.
3. Deliver the sheet layout as a DXF in millimetres. The layers distinguish stock sheets, parts, remnants, cut centrelines, and labels. Part labels give the instance, dimensions in sheet axes, and rotation. JSON coordinates `x,y,w,h` are relative to the individual sheet. Positive rotation is counterclockwise with X pointing right and Y pointing up. Drilling details use the part's original local axes. The cut-list CSV gives local dimensions. The cut-sequence CSV identifies the input workpiece and both outputs. If a sheet needs no cuts, its final part assignment is recorded in the JSON.
4. The planner tries multiple part orders and cut-axis sequences. Among the layouts it finds, it selects the one using the fewest sheets, then the fewest cuts. This is a heuristic. It does not establish a global optimum. The planner rejects a placement if it would leave a positive gap narrower than the kerf on either axis. If no plan is found, this search could not fit the parts into the specified stock.
5. Check cut length, the minimum strip width the workshop can process safely, the ability to turn or support the part, access to reference edges, and operation order against the workshop's equipment. These machine limits require separate checks. For continuous grain across several fronts, use an identified common blank with a controlled secondary cutting sequence, or prepare and verify a dedicated layout. Document curves and internal cut-outs as operations after the rectangular blank is cut.
