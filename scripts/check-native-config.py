#!/usr/bin/env python3
"""Check the documented mirrored subset of Hafiz's committed Android configuration."""
import argparse
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ANDROID = "{http://schemas.android.com/apk/res/android}"


def check(root):
    expo = json.loads((root / "app.json").read_text())["expo"]
    native = root / "android/app/src/main"
    application = ET.parse(native / "AndroidManifest.xml").getroot().find("application")
    activity = next(item for item in application.findall("activity") if item.get(ANDROID + "name") == ".MainActivity")
    resources = native / "res"
    colors = {item.get("name"): item.text for item in ET.parse(resources / "values/colors.xml").getroot()}
    strings = {item.get("name"): item.text for item in ET.parse(resources / "values/strings.xml").getroot()}
    styles = {item.get("name"): item for item in ET.parse(resources / "values/styles.xml").getroot()}
    gradle = (root / "android/app/build.gradle").read_text()
    errors = []

    def require(condition, message):
        if not condition:
            errors.append(message)

    def resource_exists(value):
        match = re.fullmatch(r"@(drawable|mipmap)/([a-z0-9_]+)", value or "")
        return bool(match and any(p.is_file() for p in resources.glob(match[1] + "*/" + match[2] + ".*")))

    def literal(name):
        matches = re.findall(r"^\s*" + name + r"\s+['\"]([^'\"]+)['\"]", gradle, re.MULTILINE)
        return matches[0] if len(matches) == 1 else None

    def color(value):
        return colors.get(value.removeprefix("@color/")) if value.startswith("@color/") else value

    require(literal("applicationId") == expo["android"]["package"], "Android applicationId differs from app.json")
    require(literal("namespace") == expo["android"]["package"], "Android namespace differs from app.json")
    require(literal("versionName") == expo["version"], "Android versionName differs from app.json")
    require(strings.get("app_name") == expo["name"], "Android app name differs from app.json")
    require(activity.get(ANDROID + "screenOrientation") == expo["orientation"], "Android orientation differs from app.json")
    schemes = set()
    for intent in activity.findall("intent-filter"):
        actions = {item.get(ANDROID + "name") for item in intent.findall("action")}
        categories = {item.get(ANDROID + "name") for item in intent.findall("category")}
        if "android.intent.action.VIEW" in actions and {"android.intent.category.DEFAULT", "android.intent.category.BROWSABLE"} <= categories:
            schemes.update(item.get(ANDROID + "scheme") for item in intent.findall("data"))
    require(schemes == {expo["scheme"]}, "Android browsable scheme differs from app.json")
    predictive = expo["android"]["predictiveBackGestureEnabled"]
    require(isinstance(predictive, bool) and application.get(ANDROID + "enableOnBackInvokedCallback") == str(predictive).lower(), "Android predictive back differs from app.json")
    require(application.get(ANDROID + "supportsRtl") == "true", "Android RTL support must remain enabled")
    require(expo["userInterfaceStyle"] == "automatic" and styles["AppTheme"].get("parent") == "Theme.AppCompat.DayNight.NoActionBar", "Review automatic/DayNight theme ownership")
    splash = {item.get("name"): item.text for item in styles["Theme.App.SplashScreen"]}
    require(color(splash["windowSplashScreenBackground"]).lower() == expo["splash"]["backgroundColor"].lower(), "Android splash background differs from app.json")
    require(strings.get("expo_splash_screen_resize_mode") == expo["splash"]["resizeMode"], "Android splash resize mode differs from app.json")
    require(application.get(ANDROID + "theme") == "@style/AppTheme" and activity.get(ANDROID + "theme") == "@style/Theme.App.SplashScreen", "Review native theme references")
    require(resource_exists(splash.get("windowSplashScreenAnimatedIcon")), "Missing referenced native splash icon")
    require(splash.get("postSplashScreenTheme") == "@style/AppTheme" and "AppTheme" in styles, "Review post-splash theme reference")
    for icon in ["ic_launcher", "ic_launcher_round"]:
        adaptive = ET.parse(resources / ("mipmap-anydpi-v26/" + icon + ".xml")).getroot()
        require(color(adaptive.find("background").get(ANDROID + "drawable")).lower() == expo["android"]["adaptiveIcon"]["backgroundColor"].lower(), "Android adaptive background differs from app.json")
        for layer in ["foreground", "monochrome"]:
            element = adaptive.find(layer)
            require(resource_exists(element.get(ANDROID + "drawable") if element is not None else None), "Missing referenced " + icon + " " + layer + " resource")
    require(application.get(ANDROID + "icon") == "@mipmap/ic_launcher" and application.get(ANDROID + "roundIcon") == "@mipmap/ic_launcher_round", "Review launcher icon references")
    for asset in [expo["icon"], expo["splash"]["image"], expo["android"]["adaptiveIcon"]["foregroundImage"], expo["android"]["adaptiveIcon"]["monochromeImage"]]:
        require((root / asset).is_file(), "Missing declared source asset: " + asset)
    require(bool(list(resources.glob("drawable*/splashscreen_logo.*"))), "Missing native splash resource")
    for icon in ["ic_launcher_foreground", "ic_launcher_monochrome"]:
        require(bool(list(resources.glob("mipmap-*/" + icon + ".*"))), "Missing native icon resource: " + icon)
    require(expo["plugins"] == ["expo-router", "expo-sharing", "expo-asset"], "Review changed config-plugin ownership")
    require(not (root / "ios").exists(), "Review ownership for the newly present iOS project")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    root = parser.parse_args().root
    try:
        errors = check(root)
    except (OSError, ValueError, KeyError, TypeError, AttributeError, StopIteration, ET.ParseError) as error:
        print("Native ownership input cannot be checked:", error)
        return 1
    for error in errors:
        print(error)
    if not errors:
        print("Committed Android mirrored settings and resource references pass. Bitmap parity, iOS and device behavior are not certified.")
    return int(bool(errors))


if __name__ == "__main__":
    raise SystemExit(main())
