# DIY Works

From a design to fabrication. DIY Works turns a sketch, floor plan or manufacturer's technical PDF into a dimensioned 2D drawing, an editable Blender model, and the documents a workshop needs to build it: shop drawings, bill of materials, edge-banding and drilling schedules, and panel-saw cutting plans. It also designs and revises furnished interiors across CAD and Blender, compares layout variants, checks clearances of moving parts, and renders daylight or night views.

It works in both **Claude Code** and the **OpenAI Codex** agent.

## What it Does

1. Runs a short guided brief, or starts right away from a direct request
2. Establishes geometry, scale and dimension sources (manufacturer / site / design decision / estimate)
3. Produces a 2D DXF drawing and/or an editable Blender model, as separate revisions
4. Resolves construction: parts, joints, back panel, hardware, drilling positions
5. Plans sheet cuts with `scripts/narez.py` (kerf, trims, grain, edge build-up)
6. Checks door, drawer and chair clearances with `scripts/check_clearance.py`
7. Verifies the saved files and hands over the deliverables, listing what is still unverified

```mermaid
flowchart LR
    A["/diy-works"] --> P["check_env.py"]
    P -->|"missing deps"| W["Warn user +<br/>install command"]
    P --> B["Brief"]
    W --> B
    B --> G["Geometry & scale"]
    G --> C["2D DXF"]
    G --> D["Blender model"]
    D --> E["Construction<br/>+ shop docs"]
    E --> F["Cutting plan"]
    F --> V["Verify & deliver"]

    style A fill:#7c3aed,color:#fff
    style W fill:#dc2626,color:#fff
    style V fill:#059669,color:#fff
```

## Installation

```bash
npx skills add JakubKontra/skills --skill diy-works
```

The `skills` CLI installs it for Claude Code (`.claude/skills/diy-works`) or Codex (`~/.codex/skills/diy-works`). `agents/openai.yaml` provides the Codex display name and default prompt.

## Requirements

On first use, the skill runs `scripts/check_env.py`. If something is missing, it tells you what that blocks and gives the install command, and it installs nothing without your consent.

| Dependency | Needed for | Install |
| --- | --- | --- |
| Python 3.8+ | all helper scripts | python.org |
| `shapely` | clearance checks | `python3 -m pip install shapely` |
| `ezdxf` | DXF drawings and sheet layouts | `python3 -m pip install ezdxf` |
| Blender **or** a Blender MCP server | 3D models, renders | `brew install --cask blender` |
| ODA File Converter / libredwg | `.dwg` output (optional) | opendesign.com / `brew install libredwg` |

With Homebrew or Debian Python (PEP 668), the checker suggests a dedicated venv at `~/.venvs/diy-works` instead of a global pip install.

## Quick Start

```bash
# Claude Code
/diy-works guide
/diy-works Draw a 1200×600 desk with a 3-drawer pedestal and give me a cut list for 18 mm birch ply

# Codex
$diy-works guide

# Scripts directly (from the skill directory)
python3 scripts/check_env.py --stage cutting
python3 scripts/narez.py references/priklad-skrinka.json plan.json
python3 scripts/check_clearance.py references/clearance-example.json --output clearance-report.json
```

Open `pruvodce.html` in a browser to prepare a brief offline. It exports a ZIP with `project-brief.txt` and your attachments, ready to drop into the chat.
