# From a brief or technical PDF to a drawing or model

## Create a 2D drawing

1. Convert the brief into a table of critical dimensions and constraints. For a product, capture width, depth, height, material thicknesses, offsets, and hole locations. For a room, capture clear internal dimensions, openings, and interfaces with adjacent elements. In a concept design, you may choose dimensions and identify them as design decisions.
2. Draw at 1:1 in DXF model space. Separate outlines, hidden lines, centrelines, dimensions, annotations, and any reference underlay. Use editable lines, arcs, closed curves, blocks, and dimension entities. A CAD MCP server or DXF library is suitable.
3. Choose views to describe the shape. A desk generally needs a plan and front elevation plus a section through the joint. Dimension the overall size, feature locations from a shared datum, and details that cannot be derived. Give each dimension one authoritative value.
4. Reopen the deliverables and measure a check length and the position of a hole or overhang. On a PDF, specify the sheet size, print scale, units, and revision. Inspect the full sheet for clipped dimension lines or annotations.

## Read a product's technical PDF

1. Review the relevant pages, including drawings and sections. Extract digital text directly. For a scan, use OCR and verify values against the image. Match the exact model, size, and handedness. Distinguish product dimensions, installation openings, service connections, and required clearance.
2. For each value, record the page number and view label. A single page can contain several scales or variants. Use the printed dimension in preference to a line length measured on screen.
3. When tracing, calibrate each measured view with a known dimension. Check an independent length, preferably on the other axis. Flag dimensions affected by scan distortion, ambiguous units, or conflicting callouts. Use perspective photographs for appearance. Hidden geometry requires a separate source before it can be dimensioned reliably.
4. According to the purpose, model the outer envelope, actual profile, cut-outs, connections, and installation clearance as separate objects. Decide which geometry is needed for visualisation, fitting the product into an assembly, or fabricating the product itself. Record any simplifications when a catalogue omits internal details.

## Create and verify an editable Blender model

- Use the available Blender MCP connection or run a local Blender process in the background. In an open scene, check the filename, units, existing objects, and unsaved changes. When working from a file, save a separate revision.
- Set metric units and make the conversion from millimetres explicit, for example one Blender unit equals one metre. Split the assembly into physical components. Preserve local axes, reference face, material, part ID, and instance count. Use editable profiles, modifiers, or parametric dimensions as appropriate.
- Drive the fabrication model and drawings from the same dimensions. For an existing scene, check parent and instance transforms, applied scale, modifiers, and joint positions. Measure a rotated part along its own manufacturing axes.
- Reopen the model and check the overall dimensions, thickness, and at least one locating dimension in each critical view. For mirrored variants, verify handedness from an identified view. Choose preview views and detail levels that show what the user requested.
