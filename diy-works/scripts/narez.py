"""Plan rectangular panel cuts. All input and output dimensions are millimetres."""
import argparse
import csv
import json
import os
from xml.sax.saxutils import escape
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from tempfile import NamedTemporaryFile

SIDES = ("x-", "x+", "y-", "y+")


def length(value, positive=False):
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        raise ValueError(f"Invalid length {value!r}") from None
    if not number.is_finite() or number < 0 or (positive and number == 0):
        raise ValueError(f"Length out of range: {value!r}")
    micro = number * 1000
    if micro != micro.to_integral_value():
        raise ValueError(f"Length has more than three decimal places: {value!r}")
    return int(micro)


def dims(values, count, positive):
    if not isinstance(values, list) or len(values) != count:
        raise ValueError(f"Expected {count} dimensions, received {values!r}")
    return tuple(length(v, positive) for v in values)


def mm(value):
    return value // 1000 if value % 1000 == 0 else value / 1000


def area(value):
    """Convert an area in internal units (0.001 mm squared) to m2."""
    return round(value / 10 ** 12, 4)


def quantity(value):
    if type(value) is not int or value < 1:
        raise ValueError(f"Invalid quantity: {value!r}")
    return value


def grain(value):
    if value not in ("x", "y", "none"):
        raise ValueError(f"Unknown grain direction: {value!r}")
    return value


def label(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Missing identifier: {value!r}")
    return value


@dataclass(frozen=True)
class Panel:
    id: str
    x: int
    y: int
    w: int
    h: int

    def record(self):
        return dict(id=self.id, x=mm(self.x), y=mm(self.y), w=mm(self.w), h=mm(self.h))


class Sheet:
    def __init__(self, index, stock, kerf):
        self.index = index
        self.kerf = kerf
        self.cuts = []
        self.parts = []
        self.part_area = 0
        w, h = stock["size"]
        panel = Panel("0", 0, 0, w, h)
        for side, amount in zip(SIDES, stock["trim"]):
            if amount:
                axis = side[0]
                total = panel.w if axis == "x" else panel.h
                low_size = amount - kerf if side.endswith("-") else total - amount
                low, high = self.split(panel, axis, low_size, "trim " + side)
                panel = high if side.endswith("-") else low
        self.free = [panel]

    def split(self, p, axis, low_size, purpose):
        delta = low_size + self.kerf
        w, h = p.w, p.h
        if axis == "x":
            low_shape = (p.x, p.y, low_size, h)
            high_shape = (p.x + delta, p.y, w - delta, h)
        else:
            low_shape = (p.x, p.y, w, low_size)
            high_shape = (p.x, p.y + delta, w, h - delta)
        if min(low_shape[2:] + high_shape[2:]) < 0:
            raise ValueError("Cut extends beyond the input workpiece")
        seq = len(self.cuts) + 1
        low = Panel(f"{seq}a", *low_shape) if min(low_shape[2:]) else None
        high = Panel(f"{seq}b", *high_shape) if min(high_shape[2:]) else None
        self.cuts.append(dict(step=seq, source=p.id, axis=axis, low_mm=mm(low_size),
                              kerf_mm=mm(self.kerf), low=low.id if low else "",
                              high=high.id if high else "", purpose=purpose))
        return low, high

    def place(self, panel, part, instance, size, rotation, first_axis):
        self.free.remove(panel)
        axes = ("x", "y") if first_axis == "x" else ("y", "x")
        for axis in axes:
            target, actual = (size[0], panel.w) if axis == "x" else (size[1], panel.h)
            if target != actual:
                panel, offcut = self.split(panel, axis, target, "cut")
                if offcut:
                    self.free.append(offcut)
        self.part_area += panel.w * panel.h
        self.parts.append(dict(part=part, instance=instance, rotation_deg=rotation,
                               **panel.record()))

    def summary(self, stock):
        """Material use. Areas in m2; yield is part area over the raw sheet area."""
        raw = stock["size"][0] * stock["size"][1]
        free = sorted(self.free, key=lambda p: p.w * p.h, reverse=True)
        return dict(sheet_area_m2=area(raw), parts_area_m2=area(self.part_area),
                    remnants_area_m2=area(sum(p.w * p.h for p in free)),
                    waste_area_m2=area(raw - self.part_area - sum(p.w * p.h for p in free)),
                    yield_pct=round(100 * self.part_area / raw, 1),
                    largest_remnant_mm=[mm(free[0].w), mm(free[0].h)] if free else None)


def read_job(data):
    kerf = length(data["kerf_mm"], True)
    stocks = {}
    for key, entry in data["stocks"].items():
        label(key)
        w, h = dims(entry["size_mm"], 2, True)
        trim = dims(entry["trim_mm"], 4, False)
        if any(0 < n < kerf for n in trim) or w <= sum(trim[:2]) or h <= sum(trim[2:]):
            raise ValueError(f"{key}: the edge trim must leave usable stock and include the saw kerf")
        stocks[key] = dict(size=(w, h), trim=trim, qty=quantity(entry["qty"]),
                           grain=grain(entry["grain"]), thickness=length(entry["thickness_mm"], True))
    edges = {label(code): length(edge["band_mm"]) - length(edge["premill_mm"])
             for code, edge in data["edge_types"].items()}
    rows = []
    items = {key: [] for key in stocks}
    seen = set()
    for raw in data["parts"]:
        pid = label(raw["id"])
        if pid in seen:
            raise ValueError(f"Duplicate ID: {pid}")
        seen.add(pid)
        key = raw["stock"]
        stock = stocks[key]
        part_grain = grain(raw["grain"])
        rotate = raw["allow_rotate"]
        if type(rotate) is not bool:
            raise ValueError(f"{pid}: allow_rotate must be a boolean")
        finished = dims(raw["finished_mm"], 2, True)
        banding = raw["edges"]
        if not isinstance(banding, dict) or set(banding) - set(SIDES):
            raise ValueError(f"{pid}: unknown edge identifier")
        allowance = dims(raw.get("extra_blank_mm", [0, 0]), 2, False)
        net = [edges[banding[s]] if s in banding else 0 for s in SIDES]
        w = finished[0] - sum(net[:2]) + allowance[0]
        h = finished[1] - sum(net[2:]) + allowance[1]
        if min(w, h) <= 0:
            raise ValueError(f"{pid}: blank dimensions must be positive")
        options = []
        for angle in ([0, 90] if rotate else [0]):
            axis = part_grain
            if angle and axis != "none":
                axis = "y" if axis == "x" else "x"
            if axis == "none" or axis == stock["grain"]:
                options.append(((w, h) if angle == 0 else (h, w), angle))
        if not options:
            raise ValueError(f"{pid}: the grain direction cannot be matched with this stock and the permitted rotation")
        qty = quantity(raw["qty"])
        rows.append(dict(id=pid, stock=key, qty=qty, thickness_mm=mm(stock["thickness"]),
                         finished_x=mm(finished[0]), finished_y=mm(finished[1]),
                         blank_x=mm(w), blank_y=mm(h), extra_x=mm(allowance[0]),
                         extra_y=mm(allowance[1]), grain=part_grain, allow_rotate=rotate,
                         **{s: banding.get(s, "") for s in SIDES}))
        for i in range(1, qty + 1):
            items[key].append((pid, i, w, h, options))
    if not rows:
        raise ValueError("The cut list is empty")
    return kerf, stocks, rows, items


def candidate(sheet, options):
    best = None
    for panel in sheet.free:
        for size, angle in options:
            dx, dy = panel.w - size[0], panel.h - size[1]
            if any(gap < 0 or 0 < gap < sheet.kerf for gap in (dx, dy)):
                continue
            score = (panel.w * panel.h - size[0] * size[1], min(dx, dy), angle)
            if best is None or score < best[0]:
                best = score, panel, size, angle
    return best


def pack(items, stock, kerf, by_area, first_axis):
    def order(item):
        w, h = item[2:4]
        return (w * h, max(w, h)) if by_area else (max(w, h), w * h)
    sheets = []
    for pid, i, _, _, options in sorted(items, key=order, reverse=True):
        best = None
        for sheet in sheets:
            fit = candidate(sheet, options)
            if fit and (best is None or fit[0] < best[0][0]):
                best = fit, sheet
        if best is None:
            if len(sheets) == stock["qty"]:
                return None
            sheet = Sheet(len(sheets) + 1, stock, kerf)
            fit = candidate(sheet, options)
            if fit is None:
                return None
            sheets.append(sheet)
        else:
            fit, sheet = best
        _, panel, size, angle = fit
        sheet.place(panel, pid, i, size, angle, first_axis)
    return sheets


def plan(data):
    kerf, stocks, rows, items = read_job(data)
    output = []
    totals = []
    for key, group in items.items():
        if not group:
            continue
        stock = stocks[key]
        best = None
        for by_area in (True, False):
            for axis in ("x", "y"):
                trial = pack(group, stock, kerf, by_area, axis)
                if trial is None:
                    continue
                score = (len(trial), sum(len(s.cuts) for s in trial))
                if best is None or score < best[0]:
                    best = score, trial
        if best is None:
            raise ValueError(f"{key}: the planner could not fit the parts into the specified stock. "
                             "Check sheet dimensions, quantities, trim, grain, and alternative layouts.")
        used = sum(s.part_area for s in best[1])
        raw = stock["size"][0] * stock["size"][1] * len(best[1])
        totals.append(dict(stock=key, sheets=len(best[1]), sheets_available=stock["qty"],
                           parts=len(group), cuts=sum(len(s.cuts) for s in best[1]),
                           parts_area_m2=area(used), sheet_area_m2=area(raw),
                           yield_pct=round(100 * used / raw, 1)))
        for sheet in best[1]:
            output.append(dict(stock=key, sheet=sheet.index, size_mm=list(map(mm, stock["size"])),
                               grain=stock["grain"], thickness_mm=mm(stock["thickness"]),
                               summary=sheet.summary(stock),
                               cuts=sheet.cuts, parts=sheet.parts,
                               remnants=[p.record() for p in sheet.free]))
    return dict(units="mm", kerf_mm=mm(kerf), edge_types=data["edge_types"],
                summary=totals, cutlist=rows, sheets=output)


def cut_lines(sheet):
    """Yield (cut, start, end) with the kerf centreline in sheet coordinates (mm)."""
    w, h = sheet["size_mm"]
    pending = {"0": (0, 0, w, h)}
    for cut in sheet["cuts"]:
        x, y, pw, ph = pending.pop(cut["source"])
        d, k = cut["low_mm"], cut["kerf_mm"]
        if cut["axis"] == "x":
            a, b = (x + d + k / 2, y), (x + d + k / 2, y + ph)
            lo, hi = (x, y, d, ph), (x + d + k, y, pw - d - k, ph)
        else:
            a, b = (x, y + d + k / 2), (x + pw, y + d + k / 2)
            lo, hi = (x, y, pw, d), (x, y + d + k, pw, ph - d - k)
        for code, box in ((cut["low"], lo), (cut["high"], hi)):
            if code:
                pending[code] = box
        yield cut, a, b, (pw, ph)


def write_map(result, out):
    try:
        import ezdxf
    except ImportError:
        raise ValueError("ezdxf is missing, so the DXF layout cannot be exported. Install it with: python3 -m pip install ezdxf (JSON and CSV outputs work without it).") from None
    doc = ezdxf.new("R2013", units=ezdxf.units.MM)
    for layer, color in (("SHEETS", 7), ("PARTS", 3), ("CUTS", 1), ("LABELS", 7), ("REMNANTS", 8)):
        doc.layers.new(layer, dxfattribs={"color": color})
    model = doc.modelspace()

    def outline(x, y, w, h, layer):
        corners = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
        model.add_lwpolyline(corners, close=True, dxfattribs={"layer": layer})

    def note(x, y, value, height):
        model.add_text(value, dxfattribs={"layer": "LABELS", "height": height, "insert": (x, y)})

    left = 0
    for sheet in result["sheets"]:
        w, h = sheet["size_mm"]
        font = min(w, h) / 50
        outline(left, 0, w, h, "SHEETS")
        note(left, h + font, f'{sheet["stock"]} #{sheet["sheet"]} | {w} x {h} mm | '
             f'thickness {sheet["thickness_mm"]} mm | grain {sheet["grain"]} | face up', font)
        note(left, -2 * font, "0,0   X ->   Y up", font)
        for cut, a, b, (pw, ph) in cut_lines(sheet):
            a, b = (left + a[0], a[1]), (left + b[0], b[1])
            model.add_line(a, b, dxfattribs={"layer": "CUTS"})
            note(a[0], a[1], str(cut["step"]), min(font / 2, pw / 8, ph / 8))
        for rect in sheet["remnants"]:
            outline(left + rect["x"], rect["y"], rect["w"], rect["h"], "REMNANTS")
        for part in sheet["parts"]:
            x, y = left + part["x"], part["y"]
            pw, ph = part["w"], part["h"]
            outline(x, y, pw, ph, "PARTS")
            name = f'{part["part"]} #{part["instance"]} | {pw} x {ph} | {part["rotation_deg"]} deg'
            text_size = min(font, ph / 5, .85 * pw / max(1, len(name)))
            note(x + pw * .05, y + ph * .5, name, text_size)
        left += w + 10 * font
    doc.set_modelspace_vport(height=max(s["size_mm"][1] for s in result["sheets"]) * 1.3,
                             center=(result["sheets"][0]["size_mm"][0] / 2,
                                     result["sheets"][0]["size_mm"][1] / 2))
    doc.write(out)


def write_svg(result, out):
    """Write a dependency-free SVG preview of every sheet (1 SVG unit = 1 mm, Y up)."""
    sheets = result["sheets"]
    width = max(s["size_mm"][0] for s in sheets)
    font = max(width, max(s["size_mm"][1] for s in sheets)) / 70
    margin, header = 2 * font, 4.5 * font
    blocks, top = [], margin
    for sheet in sheets:
        w, h = sheet["size_mm"]
        top += header
        blocks.append((sheet, top))
        top += h + 2 * font
    total_w, total_h = width + 2 * margin, top + margin

    def fy(top, h, y):  # sheet Y-up coordinate -> SVG Y-down coordinate
        return top + h - y

    def n(value):
        return f"{value:.2f}".rstrip("0").rstrip(".")

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n(total_w)} {n(total_h)}" '
        f'width="{n(total_w / 2)}mm" height="{n(total_h / 2)}mm" font-family="sans-serif">',
        '<defs><pattern id="hatch" width="20" height="20" patternUnits="userSpaceOnUse" '
        'patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="20" stroke="#7fb77e" '
        'stroke-width="4"/></pattern>'
        '<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" '
        'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#555"/></marker></defs>',
        f'<rect width="{n(total_w)}" height="{n(total_h)}" fill="#ffffff"/>',
    ]
    for sheet, top in blocks:
        w, h = sheet["size_mm"]
        s = sheet["summary"]
        left = margin
        title = (f'{sheet["stock"]} #{sheet["sheet"]} · {w} × {h} × {sheet["thickness_mm"]} mm · '
                 f'grain {sheet["grain"]} · yield {s["yield_pct"]} % · face up, 0,0 bottom left')
        lines.append(f'<text x="{n(left)}" y="{n(top - 1.2 * font)}" font-size="{n(font)}">'
                     f'{escape(title)}</text>')
        lines.append(f'<rect x="{n(left)}" y="{n(top)}" width="{n(w)}" height="{n(h)}" '
                     f'fill="#d9d9d9" stroke="#333" stroke-width="{n(font / 8)}"/>')
        for r in sheet["remnants"]:
            lines.append(f'<rect x="{n(left + r["x"])}" y="{n(fy(top, h, r["y"] + r["h"]))}" '
                         f'width="{n(r["w"])}" height="{n(r["h"])}" fill="url(#hatch)" '
                         f'stroke="#4c8c4a" stroke-width="{n(font / 12)}"><title>remnant '
                         f'{r["w"]} × {r["h"]}</title></rect>')
        for p in sheet["parts"]:
            x, y = left + p["x"], fy(top, h, p["y"] + p["h"])
            pw, ph = p["w"], p["h"]
            name = f'{p["part"]} #{p["instance"]}'
            size = f'{pw} × {ph}' + (f' · {p["rotation_deg"]}°' if p["rotation_deg"] else "")
            fs = min(font, ph / 4, 1.6 * pw / max(len(name), len(size), 1))
            lines.append(f'<rect x="{n(x)}" y="{n(y)}" width="{n(pw)}" height="{n(ph)}" '
                         f'fill="#fdf3dc" stroke="#8a6d2f" stroke-width="{n(font / 10)}">'
                         f'<title>{escape(name)} {escape(size)}</title></rect>')
            lines.append(f'<text x="{n(x + pw / 2)}" y="{n(y + ph / 2)}" font-size="{n(fs)}" '
                         f'text-anchor="middle">{escape(name)}</text>')
            lines.append(f'<text x="{n(x + pw / 2)}" y="{n(y + ph / 2 + 1.2 * fs)}" '
                         f'font-size="{n(0.8 * fs)}" text-anchor="middle" fill="#555">'
                         f'{escape(size)}</text>')
            if sheet["grain"] != "none":
                length = min(pw, ph) * 0.35
                ax, ay = x + pw * 0.08, y + ph * 0.85
                bx, by = (ax + length, ay) if sheet["grain"] == "x" else (ax, ay - length)
                lines.append(f'<line x1="{n(ax)}" y1="{n(ay)}" x2="{n(bx)}" y2="{n(by)}" '
                             f'stroke="#555" stroke-width="{n(font / 8)}" marker-end="url(#arrow)"/>')
        for cut, a, b, (pw, ph) in cut_lines(sheet):
            lines.append(f'<line x1="{n(left + a[0])}" y1="{n(fy(top, h, a[1]))}" '
                         f'x2="{n(left + b[0])}" y2="{n(fy(top, h, b[1]))}" stroke="#d62828" '
                         f'stroke-width="{n(font / 10)}"><title>cut {cut["step"]}: '
                         f'{escape(cut["purpose"])} {cut["low_mm"]} mm</title></line>')
            fs = min(font / 1.6, max(pw, ph) / 12)
            lines.append(f'<text x="{n(left + a[0] + fs / 4)}" y="{n(fy(top, h, a[1]) - fs / 4)}" '
                         f'font-size="{n(fs)}" fill="#d62828">{cut["step"]}</text>')
    lines.append("</svg>")
    out.write("\n".join(lines) + "\n")


def write_result(result, fmt, out):
    if fmt == "dxf":
        write_map(result, out)
        return
    if fmt == "svg":
        write_svg(result, out)
        return
    if fmt == "json":
        json.dump(result, out, ensure_ascii=False, indent=2)
        out.write("\n")
        return
    if fmt == "cutlist":
        rows = result["cutlist"]
        fields = list(rows[0])
    else:
        fields = ["stock", "sheet", "step", "source", "axis", "low_mm", "kerf_mm",
                  "low", "high", "purpose", "low_part", "high_part"]
        rows = []
        for sheet in result["sheets"]:
            parts = {p["id"]: f'{p["part"]} #{p["instance"]}' for p in sheet["parts"]}
            for cut in sheet["cuts"]:
                rows.append(dict(stock=sheet["stock"], sheet=sheet["sheet"], **cut,
                                 low_part=parts.get(cut["low"], ""),
                                 high_part=parts.get(cut["high"], "")))
    writer = csv.DictWriter(out, fieldnames=fields, delimiter=";")
    writer.writeheader()
    writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--format", choices=["json", "cutlist", "cuts", "dxf", "svg"], default="json")
    args = parser.parse_args()
    temp = None
    try:
        if args.job.resolve() == args.output.resolve():
            raise ValueError("The input and output must be different files")
        result = plan(json.loads(args.job.read_text(encoding="utf-8-sig")))
        with NamedTemporaryFile(mode="w", encoding="utf-8", newline="",
                                dir=args.output.parent, delete=False) as out:
            temp = Path(out.name)
            write_result(result, args.format, out)
        os.replace(temp, args.output)
    except (ValueError, KeyError, TypeError, AttributeError, OSError) as exc:
        parser.exit(1, f"Cutting plan error: {exc}\n")
    finally:
        if temp is not None:
            temp.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
