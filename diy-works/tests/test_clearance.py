import json
import tempfile
import unittest
from pathlib import Path

from helpers import REFS, has, run


class Clearance(unittest.TestCase):
    @unittest.skipUnless(has("shapely"), "shapely not installed")
    def test_example_statuses(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "report.json"
            done = run("check_clearance.py", REFS / "clearance-example.json", "--output", out)
            self.assertEqual(done.returncode, 0, done.stderr)
            statuses = {(c["subject"], c["obstacle"]): c["status"]
                        for c in json.loads(out.read_text())["checks"]}
        self.assertEqual(statuses, {("FRIDGE_DOOR", "PLANTER"): "conflict",
                                    ("CHAIR", "SIDEBOARD"): "clear",
                                    ("CHAIR", "PENDANT"): "separate_heights"})

    def test_missing_shapely_gives_install_hint(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake = Path(tmp) / "shapely"
            fake.mkdir()
            (fake / "__init__.py").write_text("raise ImportError('simulated missing shapely')\n")
            done = run("check_clearance.py", REFS / "clearance-example.json", env={"PYTHONPATH": tmp})
        self.assertEqual(done.returncode, 2)
        self.assertIn("pip install shapely", done.stderr)


if __name__ == "__main__":
    unittest.main()
