# From a design model to the workshop

## Decisions that affect the geometry

- **Site and installation.** Record site dimensions at critical heights, corner squareness, obstacles, electrical outlets, plinths, ceiling height, installation clearances, and the delivery route for assemblies. A built-in unit may need filler strips or a piece to scribe on site.
- **Construction.** Draw a section through a representative joint and show which member runs through and which fits between others. For a cabinet, resolve sides, bottom, top, a grooved or surface-mounted back, front overlays, and gaps. For a desk, resolve support direction, anchoring, knee clearance under the apron, and drawer travel. For long shelves, wall-hung units, and unusual loads, obtain the information needed to assess load capacity.
- **Material.** Specify the material type, actual thickness, finish on both faces, grain direction, and any required grain matching. For solid wood, specify grain orientation, how the boards are joined, room for seasonal movement, and the sequence from rough blanks through jointing and planing to final dimensions. The sheet cutting workflow handles rectangular blanks.
- **Hardware and services.** Record exact order codes, quantities, variants, and installation sheets. Derive drilling positions, clearances, connections, and screw lengths from the chosen construction and the manufacturer's sheet. Flag drilling that depends on hardware still to be selected. Show cable openings and access to lighting power supplies where needed.

## Keep one part record across the project

Store the part records in [`parts.json`](parts-json.md) and generate the BOM, edge-banding and drilling schedules, labels and cutting job with `scripts/bom.py`. It validates holes against the part outline and thickness.

Give every distinct physical part a stable ID. Distinguish left- and right-handed parts with different drilling patterns even when their blanks are identical. Record the assembly, part ID, name, quantity, material and thickness, finished X/Y, blank X/Y, grain, all four edges, reference face, and a link to subsequent machining. List hardware separately and retain quantities for repeated parts.

Label the low and high ends of each local axis X−/X+ and Y−/Y+. Draw axis arrows in the face detail. For each edge, record the banding code and net build-up after any pre-milling. To derive blank width from finished width, subtract the net build-up at both X edges. Apply the same calculation to depth at the Y edges. Record extra stock for a later sizing operation separately. Account for the saw kerf between pieces in the cutting plan. Confirm which dimensions the workshop expects so its ordering system applies each adjustment exactly once.

## Deliverables for the specific piece

| Deliverable | Information the workshop needs |
| --- | --- |
| Dimensioned assembly and sections, PDF and DXF as needed | Fit, depths, clearances, and how parts meet. |
| Exploded assembly and assembly sequence | Part IDs, joint locations, access for tightening, and installation order. |
| Bill of materials and edge-banding schedule, CSV or XLSX | Sheet size, thickness, quantities, finished and blank dimensions, and edge treatment. |
| Sheet layouts and ordered cuts | Location and orientation of every part instance, offcuts, and the sequence of through cuts. |
| Detail drawing for each distinct part | Datum corner, face or reverse view, finished outline, edges, hole positions, diameters and depths, blind or through drilling, grooves, and dimensions from a shared datum. Include an edge view for edge drilling. |
| Shaping template or machining profile | Final outline, radii, reference coordinates, and finishing allowance for curves, cut-outs, and mitres. Show operations performed after the rectangular blank is cut. |
| Hardware and assembly dependencies | Specific hardware linked to its joint and drilling pattern. |

Create files in the requested formats. If the workshop uses labels, generate them from the same part records and include the ID, reference face, and grain arrow. For grain-matched assemblies, also show the orientation and placement of the group on the actual sheet.

## From a selected built-in to individual parts

1. Identify the approved room revision and the exact furniture roots. Extract the chosen assembly and its descendants. Exclude decoration, simplified hardware proxies, glassware, and neighbouring furnishings from the sheet-goods cut list. Keep purchased hardware and lighting in their own list when they belong to the assembly.
2. For each physical panel, measure the evaluated geometry in its local manufacturing axes after accounting for parent transforms, instances, and modifiers. Group identical parts only when material, edge treatment, grain, drilling, and machining all match. Keep left and right drawer banks distinct when the hardware pattern or finish differs.
3. For a shaped desktop, export a separate full-size, closed DXF profile in mm. Identify the reference corner, long arm, return, inside radius, finished edges, and supported joint if split. Use a true circular arc when the intended corner is circular. Reopen the DXF and check its extents, radius, closure and handedness against the approved model. The bounding rectangle belongs in the saw list as a blank, and the dimensioned outline goes to the next machining operation.
4. Draw elevations and sections through the working bay, top support, drawer carcass, overhead cabinets and open niche as applicable. Locate reveals, adjustable shelves, hardware, cable holes, LED channels and access to the driver. Use the actual mounting system and purchased parts for drilling dimensions. A visual drawer front does not establish the runner setback.
5. Separate the workshop, purchasing, and site operations. For a corner desk these might include cutting rectangular panels, routing the inside radius, banding visible edges, drilling the selected runner pattern, trial assembly, and scribing the finished top to the actual wall. State whether each critical dimension refers to the blank, machined substrate, or completed part.

## Final checks

Reconstruct the overall assembly dimensions from its parts, gaps, and overhangs. Match quantities and IDs across the scene, drawings, bill of materials, and sheet layouts. Check mirrored drilling, hole depths against part thickness, door and drawer travel, and handling order. Verify available stock, full-length cuts across each workpiece, maximum cut lengths, and the smallest piece the workshop's equipment can clamp safely. Mark the revision and release status of the affected items. Identify any site measurements, process details, or hardware installation sheets still required before release.
