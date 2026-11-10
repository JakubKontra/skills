# Worked example: open cabinet (SKRINKA-01)

A complete, small project that goes from the brief to the workshop files. Use it as a template for `parts.json` and as test data (`tests/` regenerates `expected/` and compares the results).

## Brief

> Otevřená skříňka 600 × 720 mm, hloubka 400 mm, z 18mm dřevotřísky v dekoru dub, s přední hranou ABS 2 mm. Jedna přestavitelná police na kolíčcích (systém 32 mm), záda z bílé HDF 3 mm přišroubovaná zezadu. Bez dvířek.
>
> *(An open cabinet, 600 wide and 720 high, 400 deep, made from 18 mm oak-decor particleboard with a 2 mm ABS front edge. One adjustable shelf on pins (32 mm system), a white 3 mm HDF back screwed on from behind. No doors.)*

## Decisions recorded in `parts.json`

| Item | Decision | Source |
| --- | --- | --- |
| Overall size | 600 × 403 × 720 (400 carcass + 3 back) | design decision |
| Construction | sides run full height, top and bottom fit between them | design decision |
| Shelf | 562 × 380, 1 mm play per side, 10 mm set back | design decision |
| Shelf pins | Ø5 × 12 mm, rows 37 mm from the front and back edges, 5 holes on 32 mm pitch around mid-height | 32 mm system |
| Edge build-up | ABS 2 mm, 0.5 mm pre-milling → +1.5 mm net | workshop setting (example) |
| Saw | kerf 3.2 mm, 10 mm trim per sheet edge | workshop setting (example) |

## Regenerate

From the skill directory:

```text
python3 scripts/bom.py examples/skrinka/parts.json examples/skrinka/expected
python3 scripts/narez.py examples/skrinka/expected/narez-job.json examples/skrinka/expected/plan.json
python3 scripts/narez.py examples/skrinka/expected/narez-job.json examples/skrinka/expected/sheets.svg --format svg
python3 scripts/narez.py examples/skrinka/expected/narez-job.json examples/skrinka/expected/cut-sequence.csv --format cuts
blender -b --python scripts/blender/build_panels.py -- examples/skrinka/parts.json skrinka.blend
blender -b skrinka.blend --python scripts/blender/measure.py -- measure.json
```

The yield is low (21 % on a full 2800 × 2070 sheet), because a single cabinet uses only part of a sheet. The remnants are listed in `plan.json` for the next job.
