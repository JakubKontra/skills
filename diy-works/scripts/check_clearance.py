"""Check plan clearances throughout a horizontal motion. All lengths are in mm."""
import argparse
import json
import math
import os
import sys
from pathlib import Path
from tempfile import NamedTemporaryFile

try:
    from shapely.affinity import rotate, translate
    from shapely.geometry import Polygon
except ImportError:
    print("shapely is missing, so the clearance check cannot run. "
          "Install it with: python3 -m pip install shapely", file=sys.stderr)
    sys.exit(2)


def number(value):
    if type(value) not in (float, int) or not math.isfinite(value):
        raise ValueError(f"Expected a finite number, got {value!r}")
    return value


def pair(value):
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError(f"Expected a pair of numbers, got {value!r}")
    return tuple(number(v) for v in value)


def footprint(item):
    points = [pair(point) for point in item["outline_mm"]]
    if len(points) < 3:
        raise ValueError("A footprint needs at least three points")
    polygon = Polygon(points)
    if not polygon.is_valid or polygon.area <= 0:
        raise ValueError("Footprint must be a simple polygon with positive area")
    bottom, top = pair(item["z_mm"])
    if top <= bottom:
        raise ValueError("The top elevation must exceed the bottom elevation")
    return polygon, bottom, top


def trajectory(shape, motion):
    kind = motion["type"]
    if kind == "fixed":
        return 0, lambda fraction: shape
    if kind == "slide":
        dx, dy = pair(motion["delta_mm"])
        return math.hypot(dx, dy), lambda fraction: translate(shape, dx * fraction, dy * fraction)
    if kind == "hinge":
        pivot = pair(motion["pivot_mm"])
        start, end = pair(motion["angles_deg"])
        radius = max(math.dist(point, pivot) for point in shape.exterior.coords)
        travel = radius * abs(math.radians(end - start))
        return travel, lambda fraction: rotate(shape, start + fraction * (end - start), origin=pivot)
    raise ValueError(f"Unknown motion type {kind!r}")


def evaluate(entry, parts, resolution):
    moving, fixed = entry["subject"], entry["obstacle"]
    if moving == fixed:
        raise ValueError("Subject and obstacle must be distinct")
    shape, bottom, top = parts[moving]
    obstacle, low, high = parts[fixed]
    gap = number(entry["required_gap_mm"])
    if gap < 0:
        raise ValueError("Required gap cannot be negative")
    travel, pose = trajectory(shape, entry["motion"])
    result = dict(subject=moving, obstacle=fixed, required_gap_mm=gap)
    if top < low or high < bottom:
        return dict(result, status="separate_heights")
    # Each point on the workpiece travels at most this arc length (or slide length).
    # The nearest sample is at most half a sampling interval from any pose.
    steps = min(10000, max(1, math.ceil(travel / (2 * resolution)))) if travel else 0
    sample_error = travel / (2 * steps) if steps else 0
    best_gap = math.inf
    best_fraction = 0
    for index in range(steps + 1):
        fraction = index / steps if steps else 0
        distance = pose(fraction).distance(obstacle)
        if distance < best_gap:
            best_gap, best_fraction = distance, fraction
        if best_gap == 0:
            break
    lower = max(0, best_gap - sample_error)
    if best_gap == 0 or best_gap < gap:
        status = "conflict"
    elif lower > 0 and lower >= gap:
        status = "clear"
    else:
        status = "review"
    return dict(result, status=status, lower_gap_mm=lower, sampled_gap_mm=best_gap,
                sample_fraction=best_fraction, sampling_bound_mm=sample_error)


def check_job(job):
    if job["units"] != "mm":
        raise ValueError("Supply all coordinates, elevations and gaps in mm")
    resolution = number(job["pose_resolution_mm"])
    if resolution <= 0:
        raise ValueError("pose_resolution_mm must be positive")
    parts = {key: footprint(value) for key, value in job["objects"].items()}
    if not job["checks"]:
        raise ValueError("Specify at least one clearance check")
    return {"units": "mm", "checks": [evaluate(entry, parts, resolution) for entry in job["checks"]]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job", type=Path)
    parser.add_argument("--output", type=Path, help="Write the JSON report to this file")
    args = parser.parse_args()
    temp = None
    try:
        report = check_job(json.loads(args.job.read_text(encoding="utf-8-sig")))
        payload = json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
        if args.output is None:
            print(payload, end="")
        else:
            if args.output.resolve() == args.job.resolve():
                raise ValueError("Input and output must be different files")
            with NamedTemporaryFile("w", encoding="utf-8", dir=args.output.parent, delete=False) as out:
                temp = Path(out.name)
                out.write(payload)
            os.replace(temp, args.output)
    except (ValueError, KeyError, TypeError, AttributeError, OverflowError, OSError) as exc:
        parser.exit(1, f"Clearance check error: {exc}\n")
    finally:
        if temp is not None:
            temp.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
