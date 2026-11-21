import path from "node:path";
import { fileURLToPath } from "node:url";

export const widget = path.dirname(fileURLToPath(import.meta.url));
export const out = path.join(widget, "out");
export const review = path.join(widget, "review");
export const art = path.join(out, "res/drawable-nodpi");
export const spriteName = (pose) => "hafiz_widget_zayt_" + pose + ".webp";
export const sceneName = (scene, crop) => "hafiz_widget_scene_" + scene + "_" + crop + ".webp";
