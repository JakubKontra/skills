import json
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

from helpers import REFS, has, run

import narez


def load(name):
    return json.loads((REFS / name).read_text(encoding="utf-8"))


class SampleCabinet(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.job = load("priklad-skrinka.json")
        cls.result = narez.plan(cls.job)

    def test_blank_accounts_for_edge_build_up(self):
        side = next(r for r in self.result["cutlist"] if r["id"] == "SIDE")
        self.assertEqual((side["blank_x"], side["blank_y"]), (720, 398.5))  # 400 - 2 + 0.5

    def test_every_instance_is_placed_once(self):
        placed = sorted((p["part"], p["instance"]) for s in self.result["sheets"] for p in s["parts"])
        expected = sorted((p["id"], i) for p in self.job["parts"] for i in range(1, p["qty"] + 1))
        self.assertEqual(placed, expected)

    def test_parts_match_blanks_stay_on_sheet_and_do_not_overlap(self):
        blanks = {r["id"]: (r["blank_x"], r["blank_y"]) for r in self.result["cutlist"]}
        for sheet in self.result["sheets"]:
            w, h = sheet["size_mm"]
            boxes = sheet["parts"]
            for p in boxes:
                size = (p["w"], p["h"]) if p["rotation_deg"] == 0 else (p["h"], p["w"])
                self.assertEqual(size, blanks[p["part"]])
                self.assertTrue(0 <= p["x"] and p["x"] + p["w"] <= w and 0 <= p["y"] and p["y"] + p["h"] <= h)
            for i, a in enumerate(boxes):
                for b in boxes[i + 1:]:
                    apart = (a["x"] + a["w"] <= b["x"] or b["x"] + b["w"] <= a["x"] or
                             a["y"] + a["h"] <= b["y"] or b["y"] + b["h"] <= a["y"])
                    self.assertTrue(apart, f"{a} overlaps {b}")

    def test_yield_summary_is_consistent(self):
        sheet = self.result["sheets"][0]
        s = sheet["summary"]
        area = sum(p["w"] * p["h"] for p in sheet["parts"]) / 1e6
        self.assertAlmostEqual(s["parts_area_m2"], round(area, 4))
        self.assertAlmostEqual(s["sheet_area_m2"] - s["parts_area_m2"] - s["remnants_area_m2"],
                               s["waste_area_m2"], places=3)
        self.assertEqual(self.result["summary"][0]["sheets"], 1)

    def test_cut_lines_span_their_workpiece(self):
        for sheet in self.result["sheets"]:
            for cut, a, b, _ in narez.cut_lines(sheet):
                self.assertTrue(a[0] == b[0] or a[1] == b[1], cut)

    def test_svg_is_valid_xml_and_labels_every_part(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "plan.svg"
            done = run("narez.py", REFS / "priklad-skrinka.json", out, "--format", "svg")
            self.assertEqual(done.returncode, 0, done.stderr)
            root = ET.parse(out).getroot()
            texts = " ".join(t.text or "" for t in root.iter("{http://www.w3.org/2000/svg}text"))
            for p in self.result["sheets"][0]["parts"]:
                self.assertIn(f'{p["part"]} #{p["instance"]}', texts)

    def test_csv_formats(self):
        with tempfile.TemporaryDirectory() as tmp:
            for fmt in ("cutlist", "cuts"):
                out = Path(tmp) / f"{fmt}.csv"
                done = run("narez.py", REFS / "priklad-skrinka.json", out, "--format", fmt)
                self.assertEqual(done.returncode, 0, done.stderr)
                self.assertGreater(len(out.read_text().splitlines()), 1)

    @unittest.skipUnless(has("ezdxf"), "ezdxf not installed")
    def test_dxf_export(self):
        import ezdxf
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "plan.dxf"
            done = run("narez.py", REFS / "priklad-skrinka.json", out, "--format", "dxf")
            self.assertEqual(done.returncode, 0, done.stderr)
            layers = {e.dxf.layer for e in ezdxf.readfile(out).modelspace()}
            self.assertTrue({"SHEETS", "PARTS", "CUTS", "LABELS"} <= layers)

    @unittest.skipIf(has("ezdxf"), "ezdxf is installed")
    def test_dxf_without_ezdxf_explains_how_to_install(self):
        with tempfile.TemporaryDirectory() as tmp:
            done = run("narez.py", REFS / "priklad-skrinka.json", Path(tmp) / "x.dxf", "--format", "dxf")
            self.assertEqual(done.returncode, 1)
            self.assertIn("pip install ezdxf", done.stderr)


class InvalidJobs(unittest.TestCase):
    def job(self, **changes):
        job = load("priklad-skrinka.json")
        job.update(changes)
        return job

    def test_duplicate_id(self):
        job = self.job()
        job["parts"].append(dict(job["parts"][0]))
        with self.assertRaisesRegex(ValueError, "Duplicate ID"):
            narez.plan(job)

    def test_grain_cannot_be_matched(self):
        job = self.job()
        job["parts"][0]["grain"] = "y"
        with self.assertRaisesRegex(ValueError, "grain"):
            narez.plan(job)

    def test_stock_too_small(self):
        job = self.job()
        job["parts"][0]["qty"] = 20
        with self.assertRaisesRegex(ValueError, "could not fit"):
            narez.plan(job)

    def test_too_many_decimals(self):
        with self.assertRaisesRegex(ValueError, "three decimal"):
            narez.plan(self.job(kerf_mm=3.2001))


if __name__ == "__main__":
    unittest.main()
