import fs from "node:fs";
import path from "node:path";
import { widgetArt } from "@/lib/widget/copy";
import { WIDGET_PALETTES } from "@/lib/widget/palette";
import {
  WIDGET_FLAMES,
  WIDGET_MAX_TIER,
  WIDGET_POSES,
  WIDGET_SCENES,
  WIDGET_STATES,
  WIDGET_URGENCIES,
} from "@/lib/widget/types";

const root = path.resolve(__dirname, "../..");
const res = path.join(root, "android/app/src/main/res");
const read = (file: string) => fs.readFileSync(path.join(res, file), "utf8");

/** name -> value for <color> or <string> resources in one values file. */
function resources(file: string, tag: "color" | "string"): Map<string, string> {
  const values = new Map<string, string>();
  for (const match of read(file).matchAll(new RegExp(`<${tag} name="([^"]+)"[^>]*>([^<]*)</${tag}>`, "g"))) {
    values.set(match[1], match[2]);
  }
  return values;
}

/** The attributes of the first element with this tag name. */
function attributes(xml: string, tag: string): Map<string, string> {
  const element = new RegExp(`<${tag}\\b([^>]*)>`).exec(xml);
  if (!element) throw new Error(`No <${tag}>`);
  return new Map([...element[1].matchAll(/([\w:]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

const ROLES = {
  surface: "hafiz_widget_surface",
  textPrimary: "hafiz_widget_text_primary",
  textSecondary: "hafiz_widget_text_secondary",
  accent: "hafiz_widget_accent",
  accentText: "hafiz_widget_accent_text",
} as const;

describe("Android widget resources match lib/widget (spec 5.1, 9.5)", () => {
  it("gives the System theme the White and Dark palettes as resource colors", () => {
    const light = resources("values/colors.xml", "color");
    const dark = resources("values-night/colors.xml", "color");
    for (const [role, name] of Object.entries(ROLES) as [keyof typeof ROLES, string][]) {
      expect([name, light.get(name)]).toEqual([name, WIDGET_PALETTES.white[role]]);
      expect([name, dark.get(name)]).toEqual([name, WIDGET_PALETTES.dark[role]]);
    }
  });

  it("has the same widget strings in English and Arabic, with Arabic text", () => {
    const english = resources("values/strings.xml", "string");
    const arabic = resources("values-ar/strings.xml", "string");
    const widgetNames = (values: Map<string, string>) =>
      [...values.keys()].filter((name) => name.startsWith("hafiz_widget_")).sort();
    expect(widgetNames(arabic)).toEqual(widgetNames(english));
    expect(widgetNames(english)).toEqual(
      expect.arrayContaining([
        "hafiz_widget_small_label",
        "hafiz_widget_medium_label",
        "hafiz_widget_small_description",
        "hafiz_widget_medium_description",
        "hafiz_widget_open_app",
        "hafiz_widget_preview_count",
      ]),
    );
    for (const name of widgetNames(arabic)) {
      expect([name, /[؀-ۿ]/.test(arabic.get(name)!)]).toEqual([name, true]);
    }
    expect(english.get("hafiz_widget_small_label")).toBe("Hafiz streak");
    expect(arabic.get("hafiz_widget_medium_label")).toBe("وِرد حافظ");
  });

  it("has a sky in both crops for every scene and a still for every pose, each named in WidgetArt.kt", () => {
    const kotlin = fs.readFileSync(
      path.join(root, "android/app/src/main/java/com/anonymous/hafiz/widget/WidgetArt.kt"),
      "utf8",
    );
    const art = (name: string) => fs.existsSync(path.join(res, `drawable-nodpi/${name}.webp`));
    for (const scene of WIDGET_SCENES) {
      for (const crop of ["sq", "wide"]) {
        const name = `hafiz_widget_scene_${scene}_${crop}`;
        expect([name, art(name), kotlin.includes(`R.drawable.${name}`)]).toEqual([name, true, true]);
      }
    }
    for (const pose of WIDGET_POSES) {
      const name = `hafiz_widget_zayt_${pose}`;
      expect([name, art(name), kotlin.includes(`R.drawable.${name}`)]).toEqual([name, true, true]);
    }
    for (const layout of kotlin.matchAll(/R\.layout\.(hafiz_widget_\w+)/g)) {
      expect([layout[1], fs.existsSync(path.join(res, `layout/${layout[1]}.xml`))]).toEqual([layout[1], true]);
    }
    const flames = [...Array.from({ length: WIDGET_MAX_TIER + 1 }, (_, tier) => `lit_t${tier}`), "unlit", "out"];
    for (const flame of flames) {
      const name = `hafiz_widget_flame_${flame}`;
      expect([
        name,
        fs.existsSync(path.join(res, `drawable/${name}.xml`)),
        kotlin.includes(`R.drawable.${name}`),
      ]).toEqual([name, true, true]);
    }
  });

  it("keeps the roomy 4 by 2 identical to the regular one except for Zayt's width cap", () => {
    const body = (file: string) => read(`layout/${file}.xml`).replace(/^<\?xml[^>]*>\n<!--[\s\S]*?-->/, "");
    const regular = body("hafiz_widget_wide");
    const roomy = body("hafiz_widget_wide_roomy");
    expect(regular).toContain('android:maxWidth="112dp"');
    expect(roomy).toContain('android:maxWidth="165dp"');
    expect(roomy.replace('android:maxWidth="165dp"', 'android:maxWidth="112dp"')).toBe(regular);
  });

  it("has a celebration clip for every pose a done day or milestone can show", () => {
    const kotlin = fs.readFileSync(
      path.join(root, "android/app/src/main/java/com/anonymous/hafiz/widget/WidgetArt.kt"),
      "utf8",
    );
    const celebration = /fun celebration[\s\S]*?else -> null/.exec(kotlin)![0];
    const poses = new Set<string>();
    for (const evening of [false, true]) {
      for (let day = 1; day <= 28; day += 1) {
        const date = `2026-11-${String(day).padStart(2, "0")}`;
        for (const state of ["done", "milestone"] as const) poses.add(widgetArt(state, "none", evening, date)[1]);
      }
    }
    for (const pose of poses) expect([pose, celebration.includes(`"${pose}" ->`)]).toEqual([pose, true]);
  });

  it("lets the Kotlin parser accept exactly the states, scenes, poses and flames JavaScript sends", () => {
    const kotlin = fs.readFileSync(
      path.join(root, "android/app/src/main/java/com/anonymous/hafiz/widget/WidgetTimeline.kt"),
      "utf8",
    );
    const set = (name: string) => {
      const match = new RegExp(`val ${name} = setOf\\(([^)]*)\\)`).exec(kotlin);
      if (!match) throw new Error(`No ${name} in WidgetTimeline.kt`);
      return [...match[1].matchAll(/"([a-z_]+)"/g)].map((value) => value[1]).sort();
    };
    expect(set("STATES")).toEqual([...WIDGET_STATES].sort());
    expect(set("SCENES")).toEqual([...WIDGET_SCENES].sort());
    expect(set("POSES")).toEqual([...WIDGET_POSES].sort());
    expect(set("FLAMES")).toEqual([...WIDGET_FLAMES].sort());
    expect(set("URGENCIES")).toEqual([...WIDGET_URGENCIES].sort());
    expect(kotlin).toContain(`const val MAX_TIER = ${WIDGET_MAX_TIER}`);
  });

  it("declares the three receivers unexported, boot completed and no exact alarms", () => {
    const manifest = fs.readFileSync(path.join(root, "android/app/src/main/AndroidManifest.xml"), "utf8");
    for (const receiver of [
      ".widget.HafizWidgetSmallProvider",
      ".widget.HafizWidgetMediumProvider",
      ".widget.HafizWidgetSystemReceiver",
    ]) {
      const element = new RegExp(`<receiver android:name="${receiver.replace(/\./g, "\\.")}"([^>]*)>`).exec(manifest);
      expect([receiver, element?.[1].includes('android:exported="false"')]).toEqual([receiver, true]);
    }
    expect(manifest).toContain('<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/>');
    expect(manifest).not.toMatch(/SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM/);
    for (const action of ["BOOT_COMPLETED", "MY_PACKAGE_REPLACED", "TIMEZONE_CHANGED", "TIME_SET", "LOCALE_CHANGED"]) {
      expect(manifest).toContain(`<action android:name="android.intent.action.${action}"/>`);
    }
  });

  it("gives both providers the sizes and settings of spec 3.1", () => {
    const expected = {
      small: {
        "android:minWidth": "110dp",
        "android:minHeight": "110dp",
        "android:targetCellWidth": "2",
        "android:targetCellHeight": "2",
        "android:minResizeWidth": "100dp",
        "android:minResizeHeight": "40dp",
        "android:maxResizeWidth": "400dp",
        "android:maxResizeHeight": "300dp",
      },
      medium: {
        "android:minWidth": "250dp",
        "android:minHeight": "130dp",
        "android:targetCellWidth": "4",
        "android:targetCellHeight": "2",
        "android:minResizeWidth": "250dp",
        "android:minResizeHeight": "130dp",
        "android:maxResizeWidth": "560dp",
        "android:maxResizeHeight": "300dp",
      },
    };
    for (const kind of ["small", "medium"] as const) {
      const info = attributes(read(`xml/hafiz_widget_${kind}_info.xml`), "appwidget-provider");
      expect(Object.fromEntries(info)).toEqual({
        "xmlns:android": "http://schemas.android.com/apk/res/android",
        ...expected[kind],
        "android:resizeMode": "horizontal|vertical",
        "android:updatePeriodMillis": "3600000",
        "android:initialLayout": "@layout/hafiz_widget_message",
        "android:previewLayout": `@layout/hafiz_widget_preview_${kind}`,
        "android:previewImage": `@drawable/hafiz_widget_preview_${kind}`,
        "android:description": `@string/hafiz_widget_${kind}_description`,
        "android:widgetCategory": "home_screen",
      });
    }
  });

  it("never autosizes widget text", () => {
    for (const file of fs.readdirSync(path.join(res, "layout")).filter((name) => name.startsWith("hafiz_widget_"))) {
      expect([file, /autoSize/.test(read(`layout/${file}`))]).toEqual([file, false]);
    }
  });
});
