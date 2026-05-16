import { useEffect, useMemo, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useColorScheme } from "nativewind";
import { useRouter } from "expo-router";
import { ArrowLeft, ArrowRight, ExternalLink, Globe2 } from "lucide-react-native";
import {
  PUBLIC_PAGE_CONTENT,
  PUBLIC_PAGE_LABELS,
  type PublicPageKey,
  type PublicPageLanguage,
  type PublicPageLink,
} from "@/lib/public-pages/content";

const UI_LANGUAGE_CACHE_KEY = "hafiz_ui_language";
const PUBLIC_PAGE_TABS: PublicPageKey[] = ["about", "privacy", "terms"];

function readInitialLanguage(): PublicPageLanguage {
  if (Platform.OS !== "web" || typeof window === "undefined") return "en";
  const cached = window.localStorage.getItem(UI_LANGUAGE_CACHE_KEY);
  return cached === "ar" ? "ar" : "en";
}

function writeLanguage(lang: PublicPageLanguage) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.localStorage.setItem(UI_LANGUAGE_CACHE_KEY, lang);
  }
}

function isInternalHref(href: string) {
  return href.startsWith("/");
}

function getExternalWebLinkProps(href: string) {
  if (Platform.OS !== "web" || isInternalHref(href)) return null;
  return {
    href,
    hrefAttrs: href.startsWith("mailto:")
      ? undefined
      : {
          target: "_blank",
          rel: "noreferrer",
        },
  } as const;
}

export function PublicPage({ page }: { page: PublicPageKey }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { colorScheme } = useColorScheme();
  const [language, setLanguage] = useState<PublicPageLanguage>(readInitialLanguage);
  const content = PUBLIC_PAGE_CONTENT[page][language];
  const labels = PUBLIC_PAGE_LABELS[language];
  const isRTL = language === "ar";
  const isDark = colorScheme === "dark";
  const BackIcon = isRTL ? ArrowRight : ArrowLeft;
  const maxWidth = width >= 1024 ? 880 : 720;
  const accent = isDark ? "#2dd4bf" : "#0d9488";
  const muted = isDark ? "#a3a3a3" : "#8B8178";

  useEffect(() => {
    writeLanguage(language);
  }, [language]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    document.title = `${content.title} | Hafiz`;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", content.description);
  }, [content.description, content.title]);

  const orderedSections = useMemo(() => content.sections, [content.sections]);

  const openLink = (link: PublicPageLink) => {
    if (isInternalHref(link.href) && !link.external) {
      router.push(link.href as any);
      return;
    }
    Linking.openURL(link.href).catch(console.warn);
  };

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          alignItems: "center",
          paddingHorizontal: width < 420 ? 18 : 28,
          paddingTop: width < 420 ? 18 : 28,
          paddingBottom: 56,
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth,
            direction: isRTL ? "rtl" : "ltr",
          }}
        >
          <View
            className="mb-6 items-center justify-between gap-3"
            style={{
              flexDirection: isRTL ? "row-reverse" : "row",
              flexWrap: "wrap",
            }}
          >
            <Pressable
              onPress={() => router.canGoBack() ? router.back() : router.replace("/" as any)}
              className="min-h-10 flex-row items-center gap-2 rounded-full bg-surface-low dark:bg-surface-dark-low px-4"
              style={({ pressed }) => ({
                opacity: pressed ? 0.72 : 1,
                ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : null),
              })}
            >
              <BackIcon size={17} color={muted} />
              <Text
                className="text-warm-700 dark:text-neutral-300"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
              >
                {labels.back}
              </Text>
            </Pressable>

            <View
              className="items-center gap-2"
              style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
            >
              <PageAction
                label={labels.home}
                onPress={() => router.replace("/" as any)}
                primary
                compact
              />
              <Pressable
                onPress={() => setLanguage(language === "en" ? "ar" : "en")}
                className="min-h-10 flex-row items-center gap-2 rounded-full bg-surface-low dark:bg-surface-dark-low px-4"
                style={({ pressed }) => ({
                  opacity: pressed ? 0.72 : 1,
                  ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : null),
                })}
              >
                <Globe2 size={16} color={accent} />
                <Text
                  className="text-primary-accent dark:text-primary-bright"
                  style={{ fontFamily: "Manrope_700Bold", fontSize: 13 }}
                >
                  {labels.language}
                </Text>
              </Pressable>
            </View>
          </View>

          <PublicPageTabs
            activePage={page}
            isDark={isDark}
            isRTL={isRTL}
            language={language}
            onChange={(nextPage) => router.replace(`/${nextPage}` as any)}
            width={width}
          />

          <View className="mb-12">
            <Text
              className="mb-4 text-primary-accent dark:text-primary-bright"
              style={{
                fontFamily: "Manrope_700Bold",
                fontSize: 12,
                letterSpacing: 0,
                textAlign: isRTL ? "right" : "left",
                textTransform: "uppercase",
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {content.eyebrow}
            </Text>
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{
                fontFamily: "NotoSerif_700Bold",
                fontSize: 38,
                lineHeight: 48,
                textAlign: isRTL ? "right" : "left",
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {content.title}
            </Text>
            <Text
              className="mt-5 text-warm-600 dark:text-neutral-400"
              style={{
                fontFamily: "Manrope_400Regular",
                fontSize: 17,
                lineHeight: 28,
                maxWidth: 760,
                textAlign: isRTL ? "right" : "left",
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {content.description}
            </Text>
            {!!content.lastUpdated && (
              <Text
                className="mt-4 text-warm-400 dark:text-neutral-500"
                style={{
                  fontFamily: "Manrope_600SemiBold",
                  fontSize: 13,
                  textAlign: isRTL ? "right" : "left",
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {content.lastUpdated}
              </Text>
            )}
          </View>

          <View className="gap-4">
            {orderedSections.map((section) => (
              <View
                key={section.title}
                className="rounded-3xl bg-surface-low dark:bg-surface-dark-low px-5 py-6"
                nativeID={section.id}
              >
                <Text
                  className="text-charcoal dark:text-neutral-100"
                  style={{
                    fontFamily: "Manrope_700Bold",
                    fontSize: 20,
                    lineHeight: 28,
                    textAlign: isRTL ? "right" : "left",
                    writingDirection: isRTL ? "rtl" : "ltr",
                  }}
                >
                  {section.title}
                </Text>
                {section.body?.map((paragraph) => (
                  <Text
                    key={paragraph}
                    className="mt-4 text-warm-700 dark:text-neutral-300"
                    style={{
                      fontFamily: "Manrope_400Regular",
                      fontSize: 15,
                      lineHeight: 25,
                      textAlign: isRTL ? "right" : "left",
                      writingDirection: isRTL ? "rtl" : "ltr",
                    }}
                  >
                    {paragraph}
                  </Text>
                ))}
                {!!section.bullets?.length && (
                  <View className="mt-4 gap-2">
                    {section.bullets.map((bullet) => (
                      <View
                        key={bullet}
                        className="gap-3"
                        style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
                      >
                        <Text
                          className="text-primary-accent dark:text-primary-bright"
                          style={{ fontFamily: "Manrope_700Bold", fontSize: 15, lineHeight: 24 }}
                        >
                          •
                        </Text>
                        <Text
                          className="flex-1 text-warm-700 dark:text-neutral-300"
                          style={{
                            fontFamily: "Manrope_400Regular",
                            fontSize: 15,
                            lineHeight: 24,
                            textAlign: isRTL ? "right" : "left",
                            writingDirection: isRTL ? "rtl" : "ltr",
                          }}
                        >
                          {bullet}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
                {!!section.links?.length && (
                  <View
                    className="mt-5 flex-wrap gap-3"
                    style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
                  >
                    {section.links.map((link) => {
                      const webLinkProps = getExternalWebLinkProps(link.href);
                      return (
                        <Pressable
                          key={`${link.href}-${link.label}`}
                          {...(webLinkProps as any)}
                          accessibilityRole="link"
                          onPress={webLinkProps ? undefined : () => openLink(link)}
                          className="min-h-10 flex-row items-center gap-2 rounded-full bg-surface-high dark:bg-surface-dark-high px-4"
                          style={({ pressed }) => ({
                            opacity: pressed ? 0.72 : 1,
                            ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : null),
                          })}
                        >
                          <Text
                            className="text-primary-accent dark:text-primary-bright"
                            style={{ fontFamily: "Manrope_700Bold", fontSize: 13 }}
                          >
                            {link.label}
                          </Text>
                          {link.external && <ExternalLink size={14} color={accent} />}
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PageAction({
  label,
  onPress,
  primary,
  compact,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  compact?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`${compact ? "min-h-10 px-4" : "min-h-11 px-5"} rounded-full items-center justify-center ${
        primary
          ? "bg-primary-accent"
          : "bg-surface-low dark:bg-surface-dark-low"
      }`}
      style={({ pressed }) => ({
        opacity: pressed ? 0.72 : 1,
        ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : null),
      })}
    >
      <Text
        className={primary ? "text-white" : "text-charcoal dark:text-neutral-200"}
        style={{ fontFamily: "Manrope_700Bold", fontSize: compact ? 13 : 14 }}
      >
        {label}
      </Text>
    </Pressable>
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
  language: PublicPageLanguage;
  onChange: (page: PublicPageKey) => void;
  width: number;
}) {
  const isCompact = width < 520;
  const inactiveTextColor = isDark ? "#d4d4d4" : "#4D4540";
  const activeTextColor = isDark ? "#f5f5f5" : "#1F2933";

  return (
    <View
      className="mb-10 rounded-full bg-surface-low dark:bg-surface-dark-low p-1"
      style={{
        alignSelf: isCompact ? "stretch" : isRTL ? "flex-end" : "flex-start",
        flexDirection: isRTL ? "row-reverse" : "row",
      }}
    >
      {PUBLIC_PAGE_TABS.map((tab) => {
        const selected = tab === activePage;
        return (
          <Pressable
            key={tab}
            {...(Platform.OS === "web"
              ? ({
                  "aria-current": selected ? "page" : undefined,
                  "aria-selected": selected,
                } as any)
              : null)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected) onChange(tab);
            }}
            className={`${isCompact ? "flex-1 px-2" : "px-5"} min-h-10 items-center justify-center rounded-full ${
              selected ? "bg-white dark:bg-surface-dark-high" : ""
            }`}
            style={({ pressed }) => ({
              opacity: pressed && !selected ? 0.72 : 1,
              ...(Platform.OS === "web"
                ? ({ cursor: selected ? "default" : "pointer" } as any)
                : null),
            })}
          >
            <Text
              className="text-center"
              numberOfLines={1}
              style={{
                color: selected ? activeTextColor : inactiveTextColor,
                fontFamily: "Manrope_700Bold",
                fontSize: isCompact ? 12 : 13,
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {PUBLIC_PAGE_CONTENT[tab][language].eyebrow}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
