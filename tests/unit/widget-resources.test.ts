import fs from "node:fs";
import path from "node:path";
import { WIDGET_PALETTES } from "@/lib/widget/palette";

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
        "hafiz_widget_preview_caption",
        "hafiz_widget_preview_headline",
      ]),
    );
    for (const name of widgetNames(arabic)) {
      expect([name, /[؀-ۿ]/.test(arabic.get(name)!)]).toEqual([name, true]);
    }
    expect(english.get("hafiz_widget_small_label")).toBe("Hafiz streak");
    expect(arabic.get("hafiz_widget_medium_label")).toBe("وِرد حافظ");
  });

  it("ships byte-identical copies of the Zayt stills", () => {
    const copies = {
      rest: "assets/zayt/S/A01_rest_pose.webp",
      warm: "assets/zayt/S/warm_smile_poster.webp",
      glow: "assets/zayt/S/A07_milestone_glow_poster.webp",
      sit: "assets/zayt/S/A11_rest_sit_poster.webp",
    };
    for (const [image, source] of Object.entries(copies)) {
      const copy = fs.readFileSync(path.join(res, `drawable-nodpi/hafiz_widget_zayt_${image}.webp`));
      expect([image, copy.equals(fs.readFileSync(path.join(root, source)))]).toEqual([image, true]);
    }
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
        "android:minHeight": "40dp",
        "android:targetCellWidth": "2",
        "android:targetCellHeight": "1",
        "android:minResizeWidth": "110dp",
        "android:minResizeHeight": "40dp",
        "android:maxResizeWidth": "400dp",
        "android:maxResizeHeight": "110dp",
      },
      medium: {
        "android:minWidth": "250dp",
        "android:minHeight": "110dp",
        "android:targetCellWidth": "4",
        "android:targetCellHeight": "2",
        "android:minResizeWidth": "250dp",
        "android:minResizeHeight": "110dp",
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
