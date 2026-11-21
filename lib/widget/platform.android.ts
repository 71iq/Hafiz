import { NativeEventEmitter, NativeModules, type NativeModule } from "react-native";
import {
  UNSUPPORTED_WIDGET_PLATFORM,
  type WidgetKind,
  type WidgetPlacement,
  type WidgetPlatform,
} from "@/lib/widget/platform-types";

/**
 * The HafizWidget module in android/app (HafizWidgetModule.kt), a legacy React Native module that the
 * new architecture's interop layer exposes. Every method runs on the widget's own native executor.
 */
type HafizWidgetModule = NativeModule & {
  publishTimeline: (json: string) => Promise<WidgetPlacement>;
  publishEarnedMilestone?: (json: string) => Promise<WidgetPlacement>;
  clearTimeline: () => Promise<void>;
  getPlacement: () => Promise<WidgetPlacement>;
  canRequestPin: () => Promise<boolean>;
  requestPin: (kind: WidgetKind) => Promise<boolean>;
};

const PLACEMENT_EVENT = "HafizWidgetPlacement";

const native = NativeModules.HafizWidget as HafizWidgetModule | undefined;
if (!native) console.warn("[Widget] The HafizWidget native module is missing, so the widget is off.");

const emitter = native ? new NativeEventEmitter(native) : null;

export const widgetPlatform: WidgetPlatform = native
  ? {
      supported: true,
      publish: (json, playMilestone) =>
        playMilestone && native.publishEarnedMilestone ? native.publishEarnedMilestone(json) : native.publishTimeline(json),
      clear: () => native.clearTimeline(),
      getPlacement: () => native.getPlacement(),
      canRequestPin: () => native.canRequestPin(),
      requestPin: (kind) => native.requestPin(kind),
      subscribePlacement: (listener) => {
        const subscription = emitter!.addListener(PLACEMENT_EVENT, () => listener());
        return () => subscription.remove();
      },
    }
  : UNSUPPORTED_WIDGET_PLATFORM;
