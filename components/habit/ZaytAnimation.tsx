import { useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { AppState, Dimensions, Platform, View } from "react-native";
import { Image } from "expo-image";
import { NavigationContext } from "@react-navigation/native";
import { useSettings } from "@/lib/settings/context";
import { useReducedMotionPreference } from "@/lib/ui/reduced-motion";
import {
  zaytClip,
  zaytMotionAllowed,
  zaytRestPose,
  zaytWidth,
  type ZaytClipRequest,
  type ZaytTier,
} from "@/lib/zayt/animations";
import { isZaytPresented, markZaytPresented } from "@/lib/zayt/presentation";

type Props = ZaytClipRequest &
  Readonly<{
    height: number;
    /**
     * The event this Zayt marks, owned by the flow (10.3). Null, or an event that already played,
     * shows the poster. A new event plays once while the screen is focused, the app is active,
     * motion is allowed and Zayt is in view.
     */
    presentationId: string | null;
    /** Called once when the event starts playing, for callers that keep the record across launches. */
    onPresented?: () => void;
  }>;

/**
 * Zayt, decorative and hidden from screen readers (ZAY-03): the text beside it carries the meaning.
 * Reduced motion, a platform without verified playback, or an event that already played shows the
 * poster, the clip's last frame. A clip that loses its conditions part way switches to the poster
 * instead of resuming, and a theme change shows the other render's poster rather than restarting.
 */
export function ZaytAnimation({ height, presentationId, onPresented, ...request }: Props) {
  const { isDark } = useSettings();
  const reduceMotion = useReducedMotionPreference();
  const focused = useScreenFocused();
  const appActive = useAppActive();
  const viewRef = useRef<View>(null);
  const [playing, setPlaying] = useState<Readonly<{ id: string; dark: boolean }> | null>(null);

  const clip = zaytClip(request, isDark);
  const canMove = zaytMotionAllowed(Platform.OS) && !reduceMotion && focused && appActive;
  const pending = presentationId !== null && !isZaytPresented(presentationId) && playing?.id !== presentationId;
  const inView = useInView(viewRef, pending && canMove);
  const isPlaying = playing !== null && playing.id === presentationId && playing.dark === isDark && canMove;

  useEffect(() => {
    if (!pending || !canMove || !inView || presentationId === null) return;
    markZaytPresented(presentationId);
    setPlaying({ id: presentationId, dark: isDark });
    onPresented?.();
  }, [pending, canMove, inView, presentationId, isDark, onPresented]);

  useEffect(() => {
    if (playing && !isPlaying) setPlaying(null);
  }, [playing, isPlaying]);

  // A pending event waits on the rest pose, the clip's first frame, so it starts without a jump.
  const source = isPlaying ? clip.animated : pending && canMove ? clip.start : clip.poster;
  const mode = isPlaying ? "playing" : pending && canMove ? "waiting" : "poster";
  return (
    <ZaytFrame viewRef={viewRef} tier={request.tier} height={height}>
      <Image
        // A new element per mode: hiding an animated web image does not stop it, replacing it does.
        key={`${mode}:${isDark ? "dark" : "light"}`}
        source={source}
        placeholder={isPlaying ? clip.start : undefined}
        placeholderContentFit="contain"
        contentFit="contain"
        transition={null}
        autoplay
        accessible={false}
        alt=""
        style={{ width: zaytWidth(request.tier, height), height }}
        testID={`zayt-${request.animation}-${mode}`}
      />
    </ZaytFrame>
  );
}

/** Zayt's rest pose (A01) as a still. */
export function ZaytStill({ tier, height }: { tier: ZaytTier; height: number }) {
  return (
    <ZaytFrame tier={tier} height={height}>
      <Image
        source={zaytRestPose(tier)}
        contentFit="contain"
        transition={null}
        accessible={false}
        alt=""
        style={{ width: zaytWidth(tier, height), height }}
        testID="zayt-rest"
      />
    </ZaytFrame>
  );
}

function ZaytFrame({
  viewRef,
  tier,
  height,
  children,
}: {
  viewRef?: RefObject<View | null>;
  tier: ZaytTier;
  height: number;
  children: ReactNode;
}) {
  return (
    <View
      ref={viewRef}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={{ width: zaytWidth(tier, height), height }}
    >
      {children}
    </View>
  );
}

/** Focus of the enclosing screen. Outside a navigator, such as in isolated tests, it counts as focused. */
function useScreenFocused(): boolean {
  const navigation = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => navigation?.isFocused() ?? true);
  useEffect(() => {
    if (!navigation) return;
    setFocused(navigation.isFocused());
    const offFocus = navigation.addListener("focus", () => setFocused(true));
    const offBlur = navigation.addListener("blur", () => setFocused(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation]);
  return focused;
}

/** The app is in front. On the web AppState follows page visibility. */
function useAppActive(): boolean {
  const [active, setActive] = useState(() => AppState.currentState !== "background" && AppState.currentState !== "inactive");
  useEffect(() => {
    // react-native-web returns nothing when the page has no visibility API.
    const subscription: { remove: () => void } | undefined = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => subscription?.remove();
  }, []);
  return active;
}

/** Most of Zayt is on screen. Checked only while a new event waits to play. */
function useInView(ref: RefObject<View | null>, enabled: boolean): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setInView(false);
      return;
    }
    if (Platform.OS === "web") {
      const node = ref.current as unknown;
      if (typeof IntersectionObserver === "undefined" || !(node instanceof Element)) {
        setInView(true);
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => setInView(entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.6)),
        { threshold: [0, 0.6, 1] },
      );
      observer.observe(node);
      return () => observer.disconnect();
    }
    let cancelled = false;
    const check = () =>
      ref.current?.measureInWindow((x, y, width, height) => {
        if (cancelled || width <= 0 || height <= 0) return;
        const window = Dimensions.get("window");
        const visibleHeight = Math.min(y + height, window.height) - Math.max(y, 0);
        const visibleWidth = Math.min(x + width, window.width) - Math.max(x, 0);
        setInView(visibleHeight >= height * 0.6 && visibleWidth >= width * 0.6);
      });
    check();
    // Native has no visibility callback for a view inside a scroll view, so poll while waiting.
    const timer = setInterval(check, 250);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, ref]);
  return enabled && inView;
}
