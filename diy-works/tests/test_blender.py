import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from helpers import EXAMPLE, SCRIPTS

import check_env

BLENDER = os.environ.get("BLENDER") or check_env.binary(
    ["blender"], ["/Applications/Blender.app/Contents/MacOS/Blender"])


@unittest.skipUnless(BLENDER, "Blender not installed")
class BlenderHelpers(unittest.TestCase):
    def blender(self, *args):
        done = subprocess.run([BLENDER, "-b", "--factory-startup", *map(str, args)],
                              capture_output=True, text=True, timeout=300)
        self.assertEqual(done.returncode, 0, done.stdout[-2000:] + done.stderr[-2000:])
        self.assertNotIn("Traceback", done.stdout + done.stderr)
        return done

    def test_build_twice_and_measure(self):
        with tempfile.TemporaryDirectory() as tmp:
            blend, report = Path(tmp) / "cab.blend", Path(tmp) / "measure.json"
            self.blender("--python", SCRIPTS / "blender" / "build_panels.py", "--", EXAMPLE / "parts.json", blend)
            # second run on the saved file must replace, not duplicate
            self.blender(blend, "--python", SCRIPTS / "blender" / "build_panels.py", "--",
                         EXAMPLE / "parts.json", blend)
            self.blender(blend, "--python", SCRIPTS / "blender" / "measure.py", "--", report)
            data = json.loads(report.read_text())
        self.assertEqual(data["problems"], [])
        self.assertEqual(data["assemblies"]["CAB"]["size_mm"], [600.0, 403.0, 720.0])
        parts = [o for o in data["objects"] if "part" in o]
        self.assertEqual(len(parts), 6)
        self.assertTrue(all(o["ok"] for o in parts))


if __name__ == "__main__":
    unittest.main()
