import copy
import csv
import json
import tempfile
import unittest
from pathlib import Path

from helpers import EXAMPLE, run

import bom
import narez

PROJECT = json.loads((EXAMPLE / "parts.json").read_text(encoding="utf-8"))


def rows(path):
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f, delimiter=";"))


class ExampleProject(unittest.TestCase):
    """Regenerate examples/skrinka/expected and compare it with the committed files."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.out = Path(cls.tmp.name)
        steps = [("bom.py", EXAMPLE / "parts.json", cls.out),
                 ("narez.py", cls.out / "narez-job.json", cls.out / "plan.json"),
                 ("narez.py", cls.out / "narez-job.json", cls.out / "sheets.svg", "--format", "svg"),
                 ("narez.py", cls.out / "narez-job.json", cls.out / "cut-sequence.csv", "--format", "cuts")]
        for step in steps:
            done = run(*step)
            assert done.returncode == 0, done.stderr

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_outputs_match_committed_expected_files(self):
        for path in sorted((EXAMPLE / "expected").iterdir()):
            with self.subTest(file=path.name):
                self.assertEqual((self.out / path.name).read_text(encoding="utf-8"),
                                 path.read_text(encoding="utf-8"),
                                 f"{path.name} changed; regenerate expected/ if this is intended")

    def test_bom_quantities_and_blanks(self):
        bom_rows = {r["part"]: r for r in rows(self.out / "bom.csv")}
        self.assertEqual(bom_rows["SIDE"]["qty"], "2")
        self.assertEqual(bom_rows["SHELF"]["blank_y"], "378.5")
        self.assertEqual(bom_rows["BACK"]["blank_x"], "600")

    def test_edge_banding_length(self):
        (abs2,) = rows(self.out / "edge-banding.csv")
        self.assertEqual(abs2["length_m"], "3.13")  # 2×720 + 2×564 + 562 mm

    def test_one_label_per_instance(self):
        self.assertEqual(len(rows(self.out / "labels.csv")),
                         sum(p["qty"] for p in PROJECT["parts"]))

    def test_ids_agree_across_bom_and_cutting_plan(self):
        plan = json.loads((self.out / "plan.json").read_text())
        placed = {p["part"] for s in plan["sheets"] for p in s["parts"]}
        self.assertEqual(placed, {r["part"] for r in rows(self.out / "bom.csv")})

    def test_bom_and_narez_agree_on_blank_sizes(self):
        job = json.loads((self.out / "narez-job.json").read_text())
        planned = {r["id"]: (r["blank_x"], r["blank_y"]) for r in narez.plan(job)["cutlist"]}
        for r in rows(self.out / "bom.csv"):
            self.assertEqual((str(planned[r["part"]][0]), str(planned[r["part"]][1])),
                             (r["blank_x"], r["blank_y"]))


class Validation(unittest.TestCase):
    def broken(self, mutate):
        data = copy.deepcopy(PROJECT)
        mutate(data)
        return data

    def assertRejects(self, mutate, pattern):
        with self.assertRaisesRegex(ValueError, pattern):
            bom.build(self.broken(mutate))

    def test_hole_outside_part(self):
        self.assertRejects(lambda d: d["parts"][0]["drilling"][0].update(x_mm=900), "outside")

    def test_hole_deeper_than_board(self):
        self.assertRejects(lambda d: d["parts"][0]["drilling"][0].update(depth_mm=19), "exceeds")

    def test_placements_must_match_quantity(self):
        self.assertRejects(lambda d: d["parts"][0]["placements"].pop(), "one entry per part")

    def test_axes_must_be_perpendicular(self):
        self.assertRejects(lambda d: d["parts"][2]["placements"][0].update(y_axis="-x"), "perpendicular")

    def test_unknown_assembly(self):
        self.assertRejects(lambda d: d["parts"][0].update(assembly="NOPE"), "unknown assembly")

    def test_assembly_quantity_multiplies_parts(self):
        data = self.broken(lambda d: d["assemblies"][0].update(qty=2))
        for p in data["stocks"].values():
            p["qty"] = 2
        result = bom.build(data)
        self.assertEqual({r["part"]: r["qty"] for r in result["bom"]}["SIDE"], 4)
        self.assertEqual(len(result["labels"]), 2 * sum(p["qty"] for p in PROJECT["parts"]))


if __name__ == "__main__":
    unittest.main()
