import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { ArrowLeft, ArrowRight, Copy, ExternalLink, Globe2 } from "lucide-react-native";
import { Toast } from "@/components/ui/Toast";
import {
  PUBLIC_PAGE_CONTENT,
  PUBLIC_PAGE_FROM_SETTINGS,
  PUBLIC_PAGE_LABELS,
  TABLE_OF_CONTENTS_MIN_SECTIONS,
  type PublicPageKey,
  type PublicPageLink,
} from "@/lib/public-pages/content";
import { useSettings } from "@/lib/settings/context";
import { textStartStyle } from "@/lib/ui/direction";

const PUBLIC_PAGE_TABS: PublicPageKey[] = ["about", "privacy", "terms", "credits"];
/** Readable line length for paragraphs, even on wide screens. */
export const PUBLIC_TEXT_MAX_WIDTH = 680;
const SETTINGS_ABOUT_HREF = "/settings?category=about";

function isInternalHref(href: string) {
  return href.startsWith("/");
}

function getExternalWebLinkProps(href: string) {
  if (Platform.OS !== "web" || isInternalHref(href)) return null;
  return {
    href,
    hrefAttrs: href.startsWith("mailto:") ? undefined : { target: "_blank", rel: "noreferrer" },
  } as const;
}

/**
 * About, Privacy, Terms and Credits. They read the cached app language and theme from the shared
 * settings provider, which renders before the local database is ready, so public information never
 * waits for data preparation. The language pill changes the shared app language.
 */
export function PublicPage({ page }: { page: PublicPageKey }) {
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string | string[] }>();
  const fromParam = Array.isArray(params.from) ? params.from[0] : params.from;
  const fromSettings = fromParam === PUBLIC_PAGE_FROM_SETTINGS;
  const { width } = useWindowDimensions();
  const { uiLanguage, setUiLanguage, isDark, isRTL, themeSurface } = useSettings();
  const language = uiLanguage;
  const content = PUBLIC_PAGE_CONTENT[page][language];
  const labels = PUBLIC_PAGE_LABELS[language];
  const [notice, setNotice] = useState<string | null>(null);
  const [emailFallback, setEmailFallback] = useState<{ sectionId: string; address: string } | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const sectionOffsets = useRef(new Map<string, number>());
  const sectionsTop = useRef(0);
  const canGoBack = router.canGoBack();
  const BackIcon = isRTL ? ArrowRight : ArrowLeft;
  const maxWidth = width >= 1024 ? 880 : 760;
  const accent = isDark ? "#2dd4bf" : "#0d9488";
  const muted = isDark ? "#a3a3a3" : "#8B8178";
  const showContents = content.sections.length >= TABLE_OF_CONTENTS_MIN_SECTIONS;
  const textDirection = { ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" } as const;
  const webCursor = Platform.OS === "web" ? ({ cursor: "pointer" } as object) : null;

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", content.description);
  }, [content.description]);

  const goBack = () => {
    if (canGoBack) router.back();
    else router.replace((fromSettings ? SETTINGS_ABOUT_HREF : "/") as Href);
  };

  const switchPage = (next: PublicPageKey) => {
    setEmailFallback(null);
    router.replace((fromSettings ? `/${next}?from=${PUBLIC_PAGE_FROM_SETTINGS}` : `/${next}`) as Href);
  };

  const openLink = (link: PublicPageLink, sectionId: string) => {
    setEmailFallback(null);
    if (isInternalHref(link.href) && !link.external) {
      router.push((fromSettings ? `${link.href}?from=${PUBLIC_PAGE_FROM_SETTINGS}` : link.href) as Href);
      return;
    }
    Linking.openURL(link.href).catch(() => {
      if (link.href.startsWith("mailto:")) setEmailFallback({ sectionId, address: link.href.slice("mailto:".length) });
      else setNotice(labels.linkFailed);
    });
  };

  const copyEmail = async (address: string) => {
    try {
      await Clipboard.setStringAsync(address);
      setNotice(labels.copied);
    } catch {
      setNotice(labels.copyFailed);
    }
  };

  const scrollToSection = useCallback((id: string) => {
    const offset = sectionOffsets.current.get(id);
    if (offset === undefined) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, sectionsTop.current + offset - 12), animated: false });
  }, []);

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: themeSurface }}>
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerStyle={{
          alignItems: "center",
          paddingHorizontal: width < 420 ? 16 : 28,
          paddingTop: width < 420 ? 18 : 28,
          paddingBottom: 56,
        }}
      >
        <View style={{ width: "100%", maxWidth, direction: isRTL ? "rtl" : "ltr" }}>
          <View className="mb-6 items-center justify-between gap-3" style={{ flexDirection: "row", flexWrap: "wrap" }}>
            <Pressable
              onPress={goBack}
              accessibilityRole="button"
              accessibilityLabel={canGoBack || fromSettings ? labels.back : labels.backToHafiz}
              className="min-h-11 flex-row items-center gap-2 rounded-full bg-surface-low px-4 dark:bg-surface-dark-low"
              style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1, ...webCursor })}
            >
              <BackIcon size={17} color={muted} />
              <Text className="text-warm-700 dark:text-neutral-300" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
                {canGoBack || fromSettings ? labels.back : labels.backToHafiz}
              </Text>
            </Pressable>

            <View className="items-center gap-2" style={{ flexDirection: "row" }}>
              {fromSettings ? null : (
                <Pressable
                  onPress={() => router.replace("/" as Href)}
                  accessibilityRole="button"
                  className="min-h-11 items-center justify-center rounded-full bg-primary-accent px-4"
                  style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1, ...webCursor })}
                >
                  <Text className="text-white" style={{ fontFamily: "Manrope_700Bold", fontSize: 13 }}>
                    {labels.home}
                  </Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => setUiLanguage(language === "en" ? "ar" : "en")}
                accessibilityRole="button"
                accessibilityLabel={labels.changeLanguage}
                className="min-h-11 flex-row items-center gap-2 rounded-full bg-surface-low px-4 dark:bg-surface-dark-low"
                style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1, ...webCursor })}
              >
                <Globe2 size={16} color={accent} />
                <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_700Bold", fontSize: 13 }}>
                  {labels.language}
                </Text>
              </Pressable>
            </View>
          </View>

          <PublicPageTabs activePage={page} isDark={isDark} isRTL={isRTL} language={language} onChange={switchPage} width={width} />

          <View className="mb-10">
            {content.eyebrow ? (
              <Text
                className="mb-4 text-primary-accent dark:text-primary-bright"
                style={{ fontFamily: "Manrope_700Bold", fontSize: 12, ...textDirection }}
              >
                {content.eyebrow}
              </Text>
            ) : null}
            <Text
              accessibilityRole="header"
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "NotoSerif_700Bold", fontSize: 38, lineHeight: 48, ...textDirection }}
            >
              {content.title}
            </Text>
            <Text
              className="mt-5 text-warm-600 dark:text-neutral-400"
              style={{ fontFamily: "Manrope_400Regular", fontSize: 17, lineHeight: 28, maxWidth: PUBLIC_TEXT_MAX_WIDTH, ...textDirection }}
            >
              {content.description}
            </Text>
            {content.lastUpdated ? (
              <Text className="mt-4 text-warm-500 dark:text-neutral-400" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, ...textDirection }}>
                {content.lastUpdated}
              </Text>
            ) : null}
          </View>

          {showContents ? (
            <View className="mb-8 rounded-3xl bg-surface-low px-5 py-4 dark:bg-surface-dark-low" accessibilityRole="list">
              <Text className="mb-2 text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_700Bold", fontSize: 15, ...textDirection }}>
                {labels.contents}
              </Text>
              {content.sections.map((section) => (
                <Pressable
                  key={section.id}
                  onPress={() => scrollToSection(section.id)}
                  accessibilityRole="link"
                  className="min-h-11 justify-center"
                  style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1, ...webCursor })}
                >
                  <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, ...textDirection }}>
                    {section.title}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View
            className="gap-4"
            onLayout={(event) => {
              sectionsTop.current = event.nativeEvent.layout.y;
            }}
          >
            {content.sections.map((section) => (
              <View
                key={section.id}
                nativeID={section.id}
                className="rounded-3xl bg-surface-low px-5 py-6 dark:bg-surface-dark-low"
                onLayout={(event) => {
                  sectionOffsets.current.set(section.id, event.nativeEvent.layout.y);
                }}
              >
                <Text
                  accessibilityRole="header"
                  className="text-charcoal dark:text-neutral-100"
                  style={{ fontFamily: "Manrope_700Bold", fontSize: 20, lineHeight: 28, ...textDirection }}
                >
                  {section.title}
                </Text>
                {section.body?.map((paragraph) => (
                  <Text
                    key={paragraph}
                    className="mt-4 text-warm-700 dark:text-neutral-300"
                    style={{ fontFamily: "Manrope_400Regular", fontSize: 15, lineHeight: 25, maxWidth: PUBLIC_TEXT_MAX_WIDTH, ...textDirection }}
                  >
                    {paragraph}
                  </Text>
                ))}
                {section.bullets?.length ? (
                  <View className="mt-4 gap-2" style={{ maxWidth: PUBLIC_TEXT_MAX_WIDTH }}>
                    {section.bullets.map((bullet) => (
                      <View key={bullet} className="gap-3" style={{ flexDirection: "row" }}>
                        <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_700Bold", fontSize: 15, lineHeight: 24 }}>
                          •
                        </Text>
                        <Text
                          className="flex-1 text-warm-700 dark:text-neutral-300"
                          style={{ fontFamily: "Manrope_400Regular", fontSize: 15, lineHeight: 24, ...textDirection }}
                        >
                          {bullet}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {section.links?.length ? (
                  <View className="mt-5 flex-wrap gap-3" style={{ flexDirection: "row" }}>
                    {section.links.map((link) => {
                      const webLinkProps = getExternalWebLinkProps(link.href);
                      return (
                        <Pressable
                          key={`${link.href}-${link.label}`}
                          {...(webLinkProps as object)}
                          accessibilityRole="link"
                          accessibilityHint={link.external ? labels.external : undefined}
                          onPress={webLinkProps ? undefined : () => openLink(link, section.id)}
                          className="min-h-11 flex-row items-center gap-2 rounded-full bg-surface-high px-4 dark:bg-surface-dark-high"
                          style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1, ...webCursor })}
                        >
                          <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_700Bold", fontSize: 13 }}>
                            {link.label}
                          </Text>
                          {link.external ? <ExternalLink size={14} color={accent} /> : null}
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
                {emailFallback?.sectionId === section.id ? (
                  <View className="mt-4 gap-3 rounded-2xl bg-surface px-4 py-3 dark:bg-surface-dark" accessibilityLiveRegion="polite">
                    <Text className="text-warm-700 dark:text-neutral-300" style={{ fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 20, ...textDirection }}>
                      {labels.emailFailed}
                    </Text>
                    <View className="items-center justify-between gap-3" style={{ flexDirection: "row", flexWrap: "wrap" }}>
                      <Text selectable className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, writingDirection: "ltr" }}>
                        {emailFallback.address}
                      </Text>
                      <Pressable
                        onPress={() => void copyEmail(emailFallback.address)}
                        accessibilityRole="button"
                        accessibilityLabel={`${labels.copyEmail} ${emailFallback.address}`}
                        className="min-h-11 flex-row items-center gap-2 rounded-full bg-surface-high px-4 dark:bg-surface-dark-high"
                        style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1, ...webCursor })}
                      >
                        <Copy size={14} color={accent} />
                        <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_700Bold", fontSize: 13 }}>
                          {labels.copyEmail}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
      <Toast message={notice} onDismiss={() => setNotice(null)} />
    </SafeAreaView>
  );
}

function PublicPageTabs({
  activePage,
  isDark,
  isRTL,
  language,
  onChange,
  width,
}: {
  activePage: PublicPageKey;
  isDark: boolean;
  isRTL: boolean;
  language: "en" | "ar";
  onChange: (page: PublicPageKey) => void;
  width: number;
}) {
  const isCompact = width < 520;
  const inactiveTextColor = isDark ? "#d4d4d4" : "#4D4540";
  const activeTextColor = isDark ? "#f5f5f5" : "#1F2933";

  return (
    <View
      // Phone widths wrap long labels such as Terms of Service onto two lines instead of truncating them.
      className={`mb-10 ${isCompact ? "rounded-3xl" : "rounded-full"} bg-surface-low p-1 dark:bg-surface-dark-low`}
      style={{ alignSelf: isCompact ? "stretch" : isRTL ? "flex-end" : "flex-start", flexDirection: "row" }}
    >
      {PUBLIC_PAGE_TABS.map((tab) => {
        const selected = tab === activePage;
        return (
          <Pressable
            key={tab}
            {...(Platform.OS === "web" ? ({ "aria-current": selected ? "page" : undefined, "aria-selected": selected } as object) : null)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected) onChange(tab);
            }}
            className={`${isCompact ? "flex-1 rounded-2xl px-1.5 py-1.5" : "rounded-full px-5"} min-h-11 items-center justify-center ${
              selected ? "bg-white dark:bg-surface-dark-high" : ""
            }`}
            style={({ pressed }) => ({
              opacity: pressed && !selected ? 0.72 : 1,
              ...(Platform.OS === "web" ? ({ cursor: selected ? "default" : "pointer" } as object) : null),
            })}
          >
            <Text
              className="text-center"
              numberOfLines={isCompact ? 2 : 1}
              style={{
                color: selected ? activeTextColor : inactiveTextColor,
                fontFamily: "Manrope_700Bold",
                fontSize: isCompact ? 12 : 13,
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {PUBLIC_PAGE_CONTENT[tab][language].tabLabel}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
