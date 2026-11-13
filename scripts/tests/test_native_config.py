import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts/check-native-config.py"
spec = importlib.util.spec_from_file_location("native_config", MODULE_PATH)
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class NativeOwnershipTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        shutil.copyfile(ROOT / "app.json", self.root / "app.json")
        target = self.root / "android/app/src/main"
        target.mkdir(parents=True)
        shutil.copyfile(ROOT / "android/app/build.gradle", target.parents[1] / "build.gradle")
        shutil.copyfile(ROOT / "android/app/src/main/AndroidManifest.xml", target / "AndroidManifest.xml")
        shutil.copytree(ROOT / "android/app/src/main/res", target / "res")
        shutil.copytree(ROOT / "assets/images", self.root / "assets/images")

    def test_current_committed_configuration(self):
        self.assertEqual(checker.check(self.root), [])

    def test_each_mirrored_declaration_detects_independent_drift(self):
        original = json.loads((self.root / "app.json").read_text())
        changes = [("name", "Other"), ("orientation", "landscape"), ("scheme", "other"), ("userInterfaceStyle", "dark")]
        for name, value in changes:
            with self.subTest(field=name):
                data = json.loads(json.dumps(original))
                data["expo"][name] = value
                (self.root / "app.json").write_text(json.dumps(data))
                self.assertTrue(checker.check(self.root))

    def test_literal_version_name_drift(self):
        gradle = self.root / "android/app/build.gradle"
        self.assertIn("versionName appJson.expo.version", gradle.read_text())
        gradle.write_text(gradle.read_text().replace("versionName appJson.expo.version", "versionName '9.0.0'"))
        self.assertTrue(checker.check(self.root))

    def test_android_package_and_back_drift(self):
        original = json.loads((self.root / "app.json").read_text())
        for name, value in [("package", "other.app"), ("predictiveBackGestureEnabled", True)]:
            with self.subTest(field=name):
                data = json.loads(json.dumps(original))
                data["expo"]["android"][name] = value
                (self.root / "app.json").write_text(json.dumps(data))
                self.assertTrue(checker.check(self.root))

    def test_splash_and_adaptive_background_drift(self):
        original = json.loads((self.root / "app.json").read_text())
        for branch, name, value in [("splash", "resizeMode", "cover"), ("splash", "backgroundColor", "#000000"), ("adaptiveIcon", "backgroundColor", "#000000")]:
            with self.subTest(branch=branch, field=name):
                data = json.loads(json.dumps(original))
                target = data["expo"]["android"][branch] if branch == "adaptiveIcon" else data["expo"][branch]
                target[name] = value
                (self.root / "app.json").write_text(json.dumps(data))
                self.assertTrue(checker.check(self.root))

    def test_unreviewed_plugin_and_ios_project(self):
        data = json.loads((self.root / "app.json").read_text())
        data["expo"]["plugins"].append("another-plugin")
        (self.root / "app.json").write_text(json.dumps(data))
        self.assertTrue(checker.check(self.root))
        data["expo"]["plugins"].pop()
        (self.root / "app.json").write_text(json.dumps(data))
        (self.root / "ios").mkdir()
        self.assertTrue(checker.check(self.root))

    def test_notification_icon_and_color(self):
        manifest = self.root / "android/app/src/main/AndroidManifest.xml"
        text = manifest.read_text()
        manifest.write_text(text.replace("@drawable/notification_icon", "@drawable/missing_notification_icon"))
        self.assertTrue(checker.check(self.root))
        manifest.write_text(text)
        colors = self.root / "android/app/src/main/res/values/colors.xml"
        colors.write_text(colors.read_text().replace('name="notification_icon_color">#0D9488', 'name="notification_icon_color">#000000'))
        self.assertTrue(checker.check(self.root))

    def test_missing_asset_and_native_resource(self):
        (self.root / "assets/images/icon.png").unlink()
        self.assertTrue(checker.check(self.root))
        shutil.copyfile(ROOT / "assets/images/icon.png", self.root / "assets/images/icon.png")
        self.assertEqual(checker.check(self.root), [])
        for file in (self.root / "android/app/src/main/res").glob("drawable*/splashscreen_logo.*"):
            file.unlink()
        self.assertTrue(checker.check(self.root))

    def test_each_native_resource_reference_rejects_missing_target(self):
        resources = self.root / "android/app/src/main/res"
        styles = resources / "values/styles.xml"
        paths = [styles] + [resources / ("mipmap-anydpi-v26/" + icon + ".xml") for icon in ["ic_launcher", "ic_launcher_round"]]
        originals = {p: p.read_bytes() for p in paths}
        cases = [(styles, "@drawable/splashscreen_logo", "@drawable/missing"), (styles, "@style/AppTheme", "@style/missing"), (styles, "@style/AppTheme", "@style/Theme.App.SplashScreen")]
        for p in paths[1:]:
            cases.extend((p, "@mipmap/" + name, "@mipmap/missing") for name in ["ic_launcher_foreground", "ic_launcher_monochrome"])
        for path, original, replacement in cases:
            with self.subTest(file=path.name, reference=original, replacement=replacement):
                for p, content in originals.items():
                    p.write_bytes(content)
                self.assertEqual(checker.check(self.root), [])
                self.assertIn(original, path.read_text())
                path.write_text(path.read_text().replace(original, replacement))
                self.assertTrue(checker.check(self.root))

    def test_native_orientation_drift(self):
        p = self.root / "android/app/src/main/AndroidManifest.xml"
        p.write_text(p.read_text().replace('screenOrientation="portrait"', 'screenOrientation="landscape"'))
        self.assertTrue(checker.check(self.root))


    def test_native_rtl_drift(self):
        p = self.root / "android/app/src/main/AndroidManifest.xml"
        p.write_text(p.read_text().replace('supportsRtl="true"', 'supportsRtl="false"'))
        self.assertTrue(checker.check(self.root))

    def test_cli_rejects_malformed_native_xml(self):
        (self.root / "android/app/src/main/AndroidManifest.xml").write_text("<broken")
        result = subprocess.run(["python3", "-B", str(MODULE_PATH), "--root", str(self.root)], text=True, capture_output=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("cannot be checked", result.stdout)
        self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
