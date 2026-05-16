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
            className="mb-10 items-center justify-between gap-3"
            style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
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
            <View
              className="mt-7 flex-wrap gap-3"
              style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
            >
              <PageAction
                label={labels.home}
                onPress={() => router.replace("/" as any)}
                primary
              />
              {content.actions.map((action) => (
                <PageAction
                  key={`${action.href}-${action.label}`}
                  label={action.label}
                  onPress={() => openLink(action)}
                />
              ))}
            </View>
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
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`min-h-11 rounded-full px-5 items-center justify-center ${
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
        style={{ fontFamily: "Manrope_700Bold", fontSize: 14 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
