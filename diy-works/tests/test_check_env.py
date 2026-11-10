import json
import tempfile
import unittest

from helpers import run


class CheckEnv(unittest.TestCase):
    def check(self, *args):
        with tempfile.TemporaryDirectory() as tmp:  # empty venv path: only this interpreter counts
            return run("check_env.py", "--no-blender-probe", *args, env={"DIY_WORKS_VENV": tmp + "/venv"})

    def test_json_report(self):
        done = self.check("--json")
        self.assertEqual(done.returncode, 0, done.stderr)
        report = json.loads(done.stdout)
        names = {c["name"] for c in report["checks"]}
        self.assertTrue({"Python 3.8+", "shapely (Python)", "ezdxf (Python)", "Blender"} <= names)
        for c in report["checks"]:
            self.assertTrue(c["ok"] or c["install"], c)

    def test_stage_exit_code_follows_needed_items(self):
        report = json.loads(self.check("--json", "--stage", "clearance").stdout)
        shapely = next(c for c in report["checks"] if c["name"].startswith("shapely"))
        done = self.check("--stage", "clearance")
        self.assertEqual(done.returncode, 0 if shapely["ok"] else 1)
        if not shapely["ok"]:
            self.assertIn("MISSING", done.stdout)

    def test_optional_items_never_block(self):
        report = json.loads(self.check("--json", "--stage", "2d").stdout)
        librecad = next(c for c in report["checks"] if c["name"] == "LibreCAD")
        self.assertFalse(librecad["needed"])


if __name__ == "__main__":
    unittest.main()
