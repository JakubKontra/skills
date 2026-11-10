# Revise a paired drawing and Blender scene

## Select the working revision

Start with the requested room, feature and deliverable. Match the room ID, named alternative, or recognisable arrangement before editing. Define “top”, “right”, or “the window by the fridge” against the presented view and a second landmark. An annotated screenshot can specify intent and adjacency. Use the dimensioned source to establish coordinates.

List plausible source files only when necessary. Distinguish an original drawing, an open LibreCAD autosave, a published revision, and an alternative. The newest timestamp alone cannot identify an approved layout. Check a distinguishing feature such as the straight façade, the pantry door, or the position of a bath. Read the actual scene path and revision from Blender when using MCP. If asked whether a live connection works, demonstrate it with a read-only scene query. Background Blender can produce a file when live MCP is unavailable. Report which method you actually used.

For a paired project, identify the drawing and scene that share the same revision. Reuse an existing revision marker or hash when available, or match geometry and stable object IDs. Keep later manual work when reconciling versions. If two credible files imply different edits, ask which branch is intended. When the branch is already known, use it.

## One placement, two representations

1. Work from a shared layout for the affected items. Keep a room ID, assembly or instance ID, host surface, local origin, axes, plan footprint, elevation, and source revision as needed. Distinguish a reusable block definition from an individual placement. Editing a shared block can change every instance. Make an instance-specific variant for a one-room change.
2. Read DXF model units, block base points, nested inserts, rotations, scale, and handedness. Account for the PDF page's downward Y axis when using an underlay. Establish the mapping to Blender against two known points and an asymmetric feature. Keep ceilings, roof, shell, room furnishings, operation envelopes, cameras, and seasonal objects independently visible where the project needs those layers.
3. Update both representations when the brief covers the paired files. In CAD, place an appropriately detailed symbol or footprint. In Blender, retain the object's depth, facing direction, mounting height, and parent assembly. Replace the relevant instance by ID so a second run cannot duplicate the fixture. Resolve an interrupted write by inspecting the actual scene before retrying.
4. When the brief is for the building shell, deliver walls, openings, and roof at that stage. Add a furniture layer by room when requested. When the brief is for another view, keep the current layout. Preserve alternatives separately until the user selects one.

## Details that often propagate

| Change | Trace these dependencies |
| --- | --- |
| Straighten a stepped façade | Establish the target face and which way the recess moves. Align exterior and interior faces, maintain the intended wall build-up, join return walls, and check the slab, roof or eaves, windows, room sizes, and cabinetry fixed to that face. Confirm what the source says before attributing a structural purpose to the step. |
| Add a missing partition | Compare the plan with the relevant PDF detail. Distinguish a wall from a dimension, hatch edge, or high-level unit. Check both end junctions, the doorway if any, and wall continuity at head height. |
| Remove or resize a window | Identify the individual opening. For a resize, establish which jamb, centreline, and sill stay fixed. For removal, close the actual wall opening, clear frames, reveals and obsolete symbols, and update the adjoining cabinet run or desk. Verify retained windows separately. |
| Repartition utility, pantry and WC | Map who enters from where, which partition moves, and which equipment is retained. Measure resulting clear room dimensions and floor areas, test access to appliances and services, and relocate fixtures removed by the partition. Check door swing, lintel, and clear opening in section. |
| Swap two fixtures | Retain the room and fixture identities. Re-evaluate each one's orientation, fittings, plumbing face, approach, cleaning access, and clearance at the new location. |

## Verify the saved delivery

Reopen the DXF and the saved Blender revision. Compare plan-space anchor points, outlines at the relevant cut height, finished floor levels, and an asymmetric detail. Use a section or ray checks where a filled wall, a cut-out, or a lintel could look correct in plan but differ vertically. Test relevant neighbours, including the adjacent room. Distinguish factual model measurements from a preliminary building proposal when site or engineering constraints are unresolved.

For a requested DWG, convert through a supported writer and read the delivered DWG back through a trusted reader or converter. Check units, measured dimensions, text, relevant block insert positions and rotations, and critical outlines against the working DXF. Verify the actual file type. If only DXF was produced, identify it accurately. Deliver the selected revision with links and state which paired files and views were checked.
