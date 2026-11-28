import React, { createContext, useCallback, useContext, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type NativeSyntheticEvent,
  type TargetedEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Info } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { getCachedAuthDarkMode } from "@/lib/settings/startup-theme";
import { useSettings, type ThemePalette } from "@/lib/settings/context";
import { DirectionProvider, type Direction, textStartStyle } from "@/lib/ui/direction";
import { accentIconColor, errorIconColor, mutedIconColor } from "@/lib/ui/theme-icons";
import { PERSISTENT_SIDEBAR_BREAKPOINT, SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";

const logoSource = require("@/assets/images/logo.png");

/** Space kept below a focused field so the next field or the submit button can stay visible. */
const FIELD_REVEAL_OFFSET = 112;
/** Tablet single-form card width. */
const TABLET_CARD_MAX_WIDTH = 520;

type AuthScreenShellProps = {
  locale: "en" | "ar";
  title: string;
  subtitle: string;
  appName: string;
  brandHeadline: string;
  backLabel: string;
  onBack: () => void;
  /** Accessible name of the language toggle group. */
  languageLabel?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  unavailableContent?: React.ReactNode;
};

type AuthLayout = "phone" | "tablet" | "desktop";

/** Two columns only from the 1024px sidebar breakpoint; 768-1023 shows one centered form card. */
export function authLayoutForWidth(width: number): AuthLayout {
  if (width >= PERSISTENT_SIDEBAR_BREAKPOINT) return "desktop";
  if (width >= SIDEBAR_BREAKPOINT) return "tablet";
  return "phone";
}

// A focused TextInput host instance (or a legacy numeric tag), as ScrollView accepts both.
type FieldHandle = object | number;
const RevealContext = createContext<(handle: FieldHandle | null) => void>(() => {});

/**
 * Returns an onFocus handler that scrolls the focused field above the on-screen keyboard. Native
 * only: browsers scroll focused inputs into view themselves.
 */
export function useRevealOnFocus() {
  const reveal = useContext(RevealContext);
  return useCallback(
    (event: NativeSyntheticEvent<TargetedEvent>) => {
      if (Platform.OS === "web") return;
      const target: unknown = event?.currentTarget ?? event?.nativeEvent?.target;
      reveal(typeof target === "number" || (typeof target === "object" && target !== null) ? target : null);
    },
    [reveal],
  );
}

/** Semantic colors for auth icons, following the active theme (White, Beige, Dark, AMOLED, System). */
export function useAuthIconColors(): { muted: string; accent: string; error: string; theme: ThemePalette } {
  const { effectiveTheme } = useSettings();
  return {
    muted: mutedIconColor(effectiveTheme),
    accent: accentIconColor(effectiveTheme),
    error: errorIconColor(effectiveTheme),
    theme: effectiveTheme,
  };
}

export function AuthScreenShell({
  locale,
  title,
  subtitle,
  appName,
  brandHeadline,
  backLabel,
  onBack,
  languageLabel,
  icon,
  children,
  footer,
  unavailableContent,
}: AuthScreenShellProps) {
  const { width, height } = useWindowDimensions();
  const layout = authLayoutForWidth(width);
  const isDesktop = layout === "desktop";
  const isTablet = layout === "tablet";
  const dir: Direction = locale === "ar" ? "rtl" : "ltr";
  const BackIcon = dir === "rtl" ? ChevronRight : ChevronLeft;
  const shellWidth = isDesktop ? Math.min(width - 48, 1088) : isTablet ? Math.min(width - 48, TABLET_CARD_MAX_WIDTH) : width;
  const content = unavailableContent ?? children;
  const scrollRef = useRef<ScrollView>(null);
  const colors = useAuthIconColors();

  const reveal = useCallback((handle: FieldHandle | null) => {
    if (handle === null) return;
    scrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(handle, FIELD_REVEAL_OFFSET, true);
  }, []);

  // A field focused before the keyboard opens is measured again once the keyboard has a height.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = Keyboard.addListener("keyboardDidShow", () => {
      const focused = TextInput.State.currentlyFocusedInput?.();
      reveal(focused ?? null);
    });
    return () => subscription.remove();
  }, [reveal]);

  const framed = isDesktop || isTablet;

  return (
    <DirectionProvider dir={dir}>
      <RevealContext.Provider value={reveal}>
        <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
          <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <ScrollView
              ref={scrollRef}
              className="flex-1"
              contentInsetAdjustmentBehavior="automatic"
              keyboardShouldPersistTaps="handled"
              horizontal={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{
                minHeight: height,
                alignItems: "center",
                justifyContent: framed ? "center" : "flex-start",
                paddingHorizontal: framed ? 24 : 0,
                paddingVertical: framed ? 24 : 0,
              }}
            >
              <View
                className={
                  framed
                    ? "overflow-hidden border border-surface-high bg-surface-bright dark:border-surface-dark-high dark:bg-surface-dark-low"
                    : "overflow-hidden bg-surface-bright dark:bg-surface-dark"
                }
                style={{
                  width: shellWidth,
                  maxWidth: "100%",
                  minHeight: isDesktop ? Math.min(Math.max(height - 48, 660), 860) : isTablet ? undefined : height,
                  borderRadius: framed ? 30 : 0,
                  boxShadow: framed ? "0 18px 42px rgba(45, 45, 45, 0.10)" : undefined,
                  direction: dir,
                }}
              >
                <View className={isDesktop ? "flex-1 flex-row" : "flex-1"}>
                  {isDesktop ? <BrandPanel appName={appName} headline={brandHeadline} dir={dir} /> : null}

                  <View
                    className="flex-1"
                    style={{
                      paddingHorizontal: isDesktop ? 56 : isTablet ? 36 : 16,
                      paddingTop: isDesktop ? 34 : isTablet ? 28 : 12,
                      paddingBottom: framed ? 34 : 0,
                    }}
                  >
                    <TopBar
                      appName={appName}
                      backLabel={backLabel}
                      onBack={onBack}
                      BackIcon={BackIcon}
                      dir={dir}
                      showBrand={!isDesktop}
                      iconColor={colors.muted}
                      languageLabel={languageLabel}
                    />

                    <View
                      className="w-full flex-1"
                      style={{
                        alignSelf: "center",
                        maxWidth: isDesktop ? 460 : 440,
                        paddingTop: isDesktop ? 48 : 20,
                        paddingBottom: isDesktop ? 0 : 24,
                      }}
                    >
                      <View className="items-center">
                        {icon ? (
                          <View className="items-center justify-center" style={{ marginBottom: 14 }}>
                            {icon}
                          </View>
                        ) : isDesktop ? (
                          <View className="items-center justify-center" style={{ width: 64, height: 64, marginBottom: 14 }}>
                            <AuthLogo appName={appName} size={64} imageSize={56} />
                          </View>
                        ) : null}
                        <Text
                          accessibilityRole="header"
                          className="text-center text-charcoal dark:text-neutral-100"
                          style={{
                            fontFamily: "NotoSerif_700Bold",
                            fontSize: isDesktop ? 31 : 28,
                            lineHeight: isDesktop ? 39 : 36,
                            writingDirection: dir,
                          }}
                        >
                          {title}
                        </Text>
                        <Text
                          className="text-center text-warm-600 dark:text-neutral-400"
                          style={{
                            fontFamily: "Manrope_400Regular",
                            fontSize: 15,
                            lineHeight: 22,
                            marginTop: 8,
                            marginBottom: isDesktop ? 34 : 24,
                            writingDirection: dir,
                          }}
                        >
                          {subtitle}
                        </Text>
                      </View>

                      <View className="w-full">{content}</View>
                      {footer ? <View className="w-full">{footer}</View> : null}
                    </View>
                  </View>
                </View>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </RevealContext.Provider>
    </DirectionProvider>
  );
}

type NoticeTone = "error" | "success" | "info";

/**
 * A form-level notice: server results, not field errors (those sit under their field). Starts with
 * an icon, start-aligns its text and is announced politely once by assistive technology.
 */
export function AuthFormNotice({
  message,
  tone = "error",
  dir,
  action,
}: {
  message?: string | null;
  tone?: NoticeTone;
  dir: Direction;
  action?: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean } | null;
}) {
  const colors = useAuthIconColors();
  if (!message) return null;

  const Icon = tone === "success" ? CheckCircle2 : tone === "info" ? Info : AlertCircle;
  const iconColor = tone === "error" ? colors.error : tone === "success" ? colors.accent : colors.muted;
  const containerClass =
    tone === "success"
      ? "mb-4 rounded-2xl bg-primary-accent/10 p-3 dark:bg-primary-bright/10"
      : tone === "info"
        ? "mb-4 rounded-2xl bg-surface-low p-3 dark:bg-surface-dark-high"
        : "mb-4 rounded-2xl bg-red-50 p-3 dark:bg-red-900/20";
  const textClass =
    tone === "success"
      ? "text-primary-accent dark:text-primary-bright"
      : tone === "info"
        ? "text-charcoal dark:text-neutral-200"
        : "text-red-700 dark:text-red-300";

  return (
    <View className={containerClass} accessibilityLiveRegion="polite" accessibilityRole={tone === "error" ? "alert" : "text"}>
      <View
        className="items-start gap-2"
        style={{ direction: "ltr", flexDirection: dir === "rtl" ? "row-reverse" : "row" }}
      >
        <View style={{ paddingTop: 1 }}>
          <Icon size={18} color={iconColor} />
        </View>
        <Text
          className={`min-w-0 flex-1 ${textClass}`}
          style={{
            fontFamily: "Manrope_500Medium",
            fontSize: 14,
            lineHeight: 20,
            ...textStartStyle(dir === "rtl"),
            writingDirection: dir,
          }}
        >
          {message}
        </Text>
      </View>
      {action ? (
        <Pressable
          onPress={action.onPress}
          disabled={action.disabled || action.busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: !!(action.disabled || action.busy), busy: !!action.busy }}
          className="mt-1 min-h-11 items-center gap-2"
          style={({ pressed }) => ({
            direction: "ltr",
            alignSelf: dir === "rtl" ? "flex-end" : "flex-start",
            flexDirection: dir === "rtl" ? "row-reverse" : "row",
            opacity: action.disabled && !action.busy ? 0.55 : pressed ? 0.72 : 1,
          })}
        >
          {action.busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
          <Text
            className="text-primary-accent underline dark:text-primary-bright"
            style={{ fontFamily: "Manrope_700Bold", fontSize: 14, writingDirection: dir }}
          >
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A text link with a 44px tall target, used for Forgot password and Back to Log In. */
export function AuthTextLink({
  label,
  onPress,
  dir,
  align = "end",
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  dir: Direction;
  align?: "start" | "end" | "center";
  disabled?: boolean;
}) {
  // Physical alignment under a pinned ltr row: the end side is right in English and left in Arabic.
  const alignItems =
    align === "center" ? "center" : (align === "end") === (dir === "rtl") ? "flex-start" : "flex-end";
  return (
    <View style={{ direction: "ltr", alignItems }}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="link"
        className="min-h-11 justify-center px-1"
        style={({ pressed }) => ({ opacity: disabled ? 0.55 : pressed ? 0.72 : 1 })}
      >
      <Text
        className="text-primary-accent dark:text-primary-bright"
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, writingDirection: dir }}
      >
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

export function AuthRouteLink({
  prompt,
  action,
  dir,
  onPress,
}: {
  prompt: string;
  action: string;
  dir: Direction;
  onPress: () => void;
}) {
  return (
    <View
      className="mb-2 mt-6 flex-wrap items-center justify-center gap-x-1"
      style={{ direction: "ltr", flexDirection: dir === "rtl" ? "row-reverse" : "row" }}
    >
      <Text
        className="text-warm-600 dark:text-neutral-400"
        style={{ fontFamily: "Manrope_400Regular", fontSize: 14, writingDirection: dir }}
      >
        {prompt}
      </Text>
      <Pressable onPress={onPress} accessibilityRole="link" className="min-h-11 justify-center px-1">
        <Text
          className="text-primary-accent dark:text-primary-bright"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 14, writingDirection: dir }}
        >
          {action}
        </Text>
      </Pressable>
    </View>
  );
}

export function AuthUnavailableState({
  title,
  subtitle,
  dir,
  continueLabel,
  onContinue,
}: {
  title: string;
  subtitle: string;
  dir: Direction;
  continueLabel?: string;
  onContinue?: () => void;
}) {
  return (
    <View>
      <View className="rounded-3xl bg-surface-low p-5 dark:bg-surface-dark-high">
        <Text
          className="mb-2 text-center text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 16, writingDirection: dir }}
        >
          {title}
        </Text>
        <Text
          className="text-center text-warm-600 dark:text-neutral-400"
          style={{ fontFamily: "Manrope_400Regular", fontSize: 14, lineHeight: 22, writingDirection: dir }}
        >
          {subtitle}
        </Text>
      </View>
      {continueLabel && onContinue ? (
        <Pressable
          onPress={onContinue}
          accessibilityRole="button"
          className="mt-4 min-h-12 items-center justify-center rounded-full bg-primary-muted px-5 dark:bg-primary-bright"
          style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
        >
          <Text
            className="text-center text-white dark:text-neutral-950"
            style={{ fontFamily: "Manrope_700Bold", fontSize: 15, writingDirection: dir }}
          >
            {continueLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function LanguageToggle({ label }: { label?: string }) {
  const { uiLanguage, setUiLanguage } = useSettings();
  const options = [
    { value: "en" as const, text: "English" },
    { value: "ar" as const, text: "العربية" },
  ];
  const radios = useRef<(View | null)[]>([]);
  const select = (language: typeof uiLanguage) => {
    if (language !== uiLanguage) setUiLanguage(language);
  };

  function handleRadioKey(event: React.KeyboardEvent, index: number) {
    switch (event.key) {
      case " ":
        event.preventDefault();
        select(options[index].value);
        break;
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown": {
        event.preventDefault();
        // With two radios, the previous and next option are the same.
        const next = 1 - index;
        radios.current[next]?.focus();
        select(options[next].value);
        break;
      }
    }
  }

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      className="flex-row items-center"
      style={{ direction: "ltr" }}
    >
      {options.map((option, index) => {
        const selected = uiLanguage === option.value;
        return (
          <React.Fragment key={option.value}>
            {index > 0 ? (
              <Text aria-hidden className="text-warm-400 dark:text-neutral-600" style={{ fontSize: 13 }}>
                |
              </Text>
            ) : null}
            <Pressable
              onPress={() => select(option.value)}
              {...(Platform.OS === "web" && {
                ref: (node: View | null) => {
                  radios.current[index] = node;
                },
                onKeyDown: (event: React.KeyboardEvent) => handleRadioKey(event, index),
                tabIndex: selected ? 0 : -1,
              })}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              aria-checked={selected}
              accessibilityLanguage={option.value}
              className="min-h-11 min-w-11 items-center justify-center px-2"
              style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
            >
              <Text
                className={selected ? "text-charcoal dark:text-neutral-100" : "text-warm-600 dark:text-neutral-400"}
                style={{
                  fontFamily: selected ? "Manrope_700Bold" : "Manrope_500Medium",
                  fontSize: 13,
                  writingDirection: option.value === "ar" ? "rtl" : "ltr",
                }}
              >
                {option.text}
              </Text>
            </Pressable>
          </React.Fragment>
        );
      })}
    </View>
  );
}

function TopBar({
  appName,
  backLabel,
  onBack,
  BackIcon,
  dir,
  showBrand,
  iconColor,
  languageLabel,
}: {
  appName: string;
  backLabel: string;
  onBack: () => void;
  BackIcon: typeof ChevronLeft;
  dir: Direction;
  showBrand: boolean;
  iconColor: string;
  languageLabel?: string;
}) {
  return (
    <View
      className="flex-wrap items-center justify-between gap-y-1"
      style={{ direction: "ltr", flexDirection: dir === "rtl" ? "row-reverse" : "row" }}
    >
      <View className="items-center gap-2" style={{ flexDirection: dir === "rtl" ? "row-reverse" : "row" }}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          className="h-11 w-11 items-center justify-center rounded-full bg-surface-low dark:bg-surface-dark-high"
          style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
        >
          <BackIcon size={22} color={iconColor} />
        </Pressable>
        {showBrand ? (
          <View className="items-center gap-2" style={{ flexDirection: dir === "rtl" ? "row-reverse" : "row" }}>
            <AuthLogo appName={appName} size={32} imageSize={28} />
            <Text
              className="text-primary dark:text-primary-bright"
              style={{ fontFamily: "NotoSerif_700Bold", fontSize: 22, lineHeight: 30, writingDirection: dir }}
            >
              {appName}
            </Text>
          </View>
        ) : null}
      </View>
      <LanguageToggle label={languageLabel} />
    </View>
  );
}

/** Desktop brand panel: logo, wordmark and headline only. */
function BrandPanel({ appName, headline, dir }: { appName: string; headline: string; dir: Direction }) {
  return (
    <View
      className="flex-1 bg-surface-low dark:bg-surface-dark-mid"
      style={{ paddingHorizontal: 58, paddingTop: 100, paddingBottom: 86 }}
    >
      <View
        className="items-center gap-4"
        style={{ direction: "ltr", flexDirection: dir === "rtl" ? "row-reverse" : "row" }}
      >
        <AuthLogo appName={appName} size={72} imageSize={64} />
        <Text
          className="text-primary dark:text-primary-bright"
          style={{ fontFamily: "NotoSerif_700Bold", fontSize: 50, lineHeight: 60, writingDirection: dir }}
        >
          {appName}
        </Text>
      </View>
      <Text
        className="text-primary dark:text-primary-bright"
        style={{
          marginTop: 70,
          fontFamily: "NotoSerif_700Bold",
          fontSize: 34,
          lineHeight: 42,
          maxWidth: 330,
          ...textStartStyle(dir === "rtl"),
          writingDirection: dir,
        }}
      >
        {headline}
      </Text>
    </View>
  );
}

function AuthLogo({ appName, size, imageSize }: { appName: string; size: number; imageSize: number }) {
  return (
    <View
      className="items-center justify-center rounded-full bg-surface-bright dark:bg-surface-dark-high"
      style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden" }}
    >
      <Image
        source={logoSource}
        accessibilityLabel={appName}
        style={{ width: imageSize, height: imageSize, borderRadius: imageSize / 2 }}
        resizeMode="contain"
      />
    </View>
  );
}

export function useAuthDarkMode(): boolean {
  const { colorScheme } = useColorScheme();
  return getCachedAuthDarkMode() ?? colorScheme === "dark";
}
