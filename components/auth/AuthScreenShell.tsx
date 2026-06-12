import React from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { DirectionProvider, type Direction } from "@/lib/ui/direction";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";

const logoSource = require("@/assets/images/logo.png");

type AuthScreenShellProps = {
  locale: "en" | "ar";
  title: string;
  subtitle: string;
  appName: string;
  brandHeadline: string;
  brandBody: string;
  backLabel: string;
  onBack: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  unavailableContent?: React.ReactNode;
};

export function AuthScreenShell({
  locale,
  title,
  subtitle,
  appName,
  brandHeadline,
  brandBody,
  backLabel,
  onBack,
  icon,
  children,
  footer,
  unavailableContent,
}: AuthScreenShellProps) {
  const { width, height } = useWindowDimensions();
  const isDesktop = width >= SIDEBAR_BREAKPOINT;
  const dir: Direction = locale === "ar" ? "rtl" : "ltr";
  const BackIcon = dir === "rtl" ? ChevronRight : ChevronLeft;
  const shellWidth = isDesktop ? Math.min(width - 48, 1088) : width;
  const content = unavailableContent ?? children;

  return (
    <DirectionProvider dir={dir}>
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            className="flex-1"
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
            horizontal={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              minHeight: height,
              alignItems: "center",
              justifyContent: isDesktop ? "center" : "flex-start",
              paddingHorizontal: isDesktop ? 24 : 0,
              paddingVertical: isDesktop ? 24 : 0,
            }}
          >
            <View
              className="overflow-hidden"
              style={{
                width: shellWidth,
                maxWidth: "100%",
                minHeight: isDesktop ? Math.min(Math.max(height - 48, 660), 860) : height,
                borderRadius: isDesktop ? 30 : 0,
                borderWidth: isDesktop ? 1 : 0,
                borderColor: "#E8E1DA",
                backgroundColor: "#FFFDF9",
                boxShadow: isDesktop ? "0 18px 42px rgba(45, 45, 45, 0.10)" : undefined,
                direction: dir,
              }}
            >
              <View className={isDesktop ? "flex-1 flex-row" : "flex-1"}>
                {isDesktop ? (
                  <BrandPanel
                    appName={appName}
                    headline={brandHeadline}
                    body={brandBody}
                    dir={dir}
                  />
                ) : null}

                <View
                  className="flex-1 bg-surface-bright dark:bg-surface-dark"
                  style={{
                    paddingHorizontal: isDesktop ? 56 : 20,
                    paddingTop: isDesktop ? 34 : 18,
                    paddingBottom: isDesktop ? 34 : 0,
                  }}
                >
                  <TopBar
                    appName={appName}
                    backLabel={backLabel}
                    onBack={onBack}
                    BackIcon={BackIcon}
                    dir={dir}
                    showBrand={!isDesktop}
                  />

                  <View
                    className="w-full flex-1"
                    style={{
                      alignSelf: "center",
                      maxWidth: isDesktop ? 460 : 430,
                      paddingTop: isDesktop ? 48 : 24,
                      paddingBottom: isDesktop ? 0 : 24,
                    }}
                  >
                    <View className="items-center">
                      <View
                        className="items-center justify-center"
                        style={{ width: 64, height: 64, marginBottom: 14 }}
                      >
                        {icon ?? (
                          <Image
                            source={logoSource}
                            accessibilityLabel={appName}
                            style={{ width: 58, height: 58 }}
                            resizeMode="contain"
                          />
                        )}
                      </View>
                      <Text
                        className="text-charcoal dark:text-neutral-100 text-center"
                        style={{
                          fontFamily: "NotoSerif_700Bold",
                          fontSize: isDesktop ? 31 : 30,
                          lineHeight: isDesktop ? 39 : 38,
                          writingDirection: dir,
                        }}
                      >
                        {title}
                      </Text>
                      <Text
                        className="text-warm-600 dark:text-neutral-400 text-center"
                        style={{
                          fontFamily: "Manrope_400Regular",
                          fontSize: 15,
                          lineHeight: 22,
                          marginTop: 8,
                          marginBottom: isDesktop ? 34 : 28,
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
              {!isDesktop ? <MobilePaperMotif /> : null}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </DirectionProvider>
  );
}

export function AuthFormNotice({
  message,
  tone = "error",
  dir,
}: {
  message?: string | null;
  tone?: "error" | "success";
  dir: Direction;
}) {
  if (!message) return null;

  const isSuccess = tone === "success";

  return (
    <View
      className={
        isSuccess
          ? "mb-4 rounded-2xl bg-primary-accent/10 p-3 dark:bg-primary-bright/10"
          : "mb-4 rounded-2xl bg-red-50 p-3 dark:bg-red-900/20"
      }
    >
      <Text
        className={isSuccess ? "text-center text-primary-accent dark:text-primary-bright" : "text-center text-red-600 dark:text-red-400"}
        style={{
          fontFamily: "Manrope_500Medium",
          fontSize: 13,
          lineHeight: 19,
          writingDirection: dir,
        }}
      >
        {message}
      </Text>
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
      className="mb-2 mt-7 items-center justify-center gap-1"
      style={{ flexDirection: dir === "rtl" ? "row-reverse" : "row" }}
    >
      <Text
        className="text-warm-600 dark:text-neutral-500"
        style={{ fontFamily: "Manrope_400Regular", fontSize: 14, writingDirection: dir }}
      >
        {prompt}
      </Text>
      <Pressable onPress={onPress} hitSlop={8}>
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
}: {
  title: string;
  subtitle: string;
  dir: Direction;
}) {
  return (
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
  );
}

function TopBar({
  appName,
  backLabel,
  onBack,
  BackIcon,
  dir,
  showBrand,
}: {
  appName: string;
  backLabel: string;
  onBack: () => void;
  BackIcon: typeof ChevronLeft;
  dir: Direction;
  showBrand: boolean;
}) {
  return (
    <View
      className="items-center justify-between"
      style={{
        flexDirection: dir === "rtl" ? "row-reverse" : "row",
      }}
    >
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={backLabel}
        className="h-10 w-10 items-center justify-center rounded-full bg-surface-low dark:bg-surface-dark-high"
        style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
      >
        <BackIcon size={20} color="#6E5A47" />
      </Pressable>

      {showBrand ? (
        <View
          className="items-center gap-2"
          style={{ flexDirection: dir === "rtl" ? "row-reverse" : "row" }}
        >
          <Image
            source={logoSource}
            accessibilityLabel={appName}
            style={{ width: 33, height: 33 }}
            resizeMode="contain"
          />
          <Text
            className="text-primary dark:text-primary-bright"
            style={{
              fontFamily: "NotoSerif_700Bold",
              fontSize: 28,
              lineHeight: 34,
              writingDirection: dir,
            }}
          >
            {appName}
          </Text>
        </View>
      ) : (
        <View style={{ width: 40 }} />
      )}

      <View style={{ width: 40 }} />
    </View>
  );
}

function BrandPanel({
  appName,
  headline,
  body,
  dir,
}: {
  appName: string;
  headline: string;
  body: string;
  dir: Direction;
}) {
  return (
    <View
      className="relative flex-1 overflow-hidden bg-surface-low"
      style={{
        paddingHorizontal: 58,
        paddingTop: 100,
        paddingBottom: 86,
        justifyContent: "space-between",
      }}
    >
      <View>
        <View
          className="items-center gap-4"
          style={{ flexDirection: dir === "rtl" ? "row-reverse" : "row" }}
        >
          <Image
            source={logoSource}
            accessibilityLabel={appName}
            style={{ width: 70, height: 70 }}
            resizeMode="contain"
          />
          <Text
            className="text-primary"
            style={{
              fontFamily: "NotoSerif_700Bold",
              fontSize: 50,
              lineHeight: 60,
              writingDirection: dir,
            }}
          >
            {appName}
          </Text>
        </View>

        <View style={{ marginTop: 70, alignItems: dir === "rtl" ? "flex-end" : "flex-start" }}>
          <Text
            className="text-primary"
            style={{
              fontFamily: "NotoSerif_700Bold",
              fontSize: 34,
              lineHeight: 42,
              maxWidth: 330,
              textAlign: dir === "rtl" ? "right" : "left",
              writingDirection: dir,
            }}
          >
            {headline}
          </Text>
          <View
            className="bg-gold-dark"
            style={{ width: 42, height: 2, marginTop: 28, marginBottom: 28 }}
          />
          <Text
            className="text-warm-700"
            style={{
              fontFamily: "Manrope_400Regular",
              fontSize: 17,
              lineHeight: 28,
              maxWidth: 320,
              textAlign: dir === "rtl" ? "right" : "left",
              writingDirection: dir,
            }}
          >
            {body}
          </Text>
        </View>
      </View>

      <PaperStack />
      <BotanicalLines dir={dir} />
    </View>
  );
}

function PaperStack() {
  return (
    <View pointerEvents="none" className="absolute bottom-0 left-0 right-0" style={{ height: 185 }}>
      <View
        className="absolute bg-surface"
        style={{
          left: -34,
          right: 18,
          bottom: 36,
          height: 112,
          borderTopRightRadius: 180,
          borderTopLeftRadius: 18,
          transform: [{ rotate: "-4deg" }],
          borderTopWidth: 1,
          borderColor: "#E6D8C2",
        }}
      />
      <View
        className="absolute bg-surface-bright"
        style={{
          left: -24,
          right: 42,
          bottom: 4,
          height: 116,
          borderTopRightRadius: 170,
          borderTopLeftRadius: 18,
          transform: [{ rotate: "-2deg" }],
          borderTopWidth: 1,
          borderColor: "#E8E1DA",
        }}
      />
      <View
        className="absolute bg-primary"
        style={{
          left: 138,
          bottom: 0,
          width: 54,
          height: 104,
          borderTopLeftRadius: 4,
          borderTopRightRadius: 4,
          transform: [{ rotate: "-12deg" }],
          borderWidth: 1,
          borderColor: "#C9A55C",
        }}
      />
      <View
        className="absolute"
        style={{
          left: 155,
          bottom: 50,
          width: 21,
          height: 21,
          borderWidth: 2,
          borderColor: "#C9A55C",
          transform: [{ rotate: "45deg" }],
        }}
      />
    </View>
  );
}

function BotanicalLines({ dir }: { dir: Direction }) {
  const horizontal = dir === "rtl" ? { left: 72 } : { right: 72 };

  return (
    <View pointerEvents="none" className="absolute" style={[{ top: 245, width: 120, height: 190 }, horizontal]}>
      <View
        className="absolute bg-primary-soft"
        style={{
          width: 1,
          height: 150,
          left: 61,
          top: 18,
          transform: [{ rotate: "16deg" }],
          opacity: 0.58,
        }}
      />
      {[0, 1, 2, 3, 4].map((index) => (
        <View
          key={index}
          className="absolute border-primary-soft"
          style={{
            width: 42,
            height: 18,
            left: index % 2 === 0 ? 21 : 59,
            top: 34 + index * 26,
            borderTopWidth: 1,
            borderLeftWidth: index % 2 === 0 ? 1 : 0,
            borderRightWidth: index % 2 === 0 ? 0 : 1,
            borderTopLeftRadius: index % 2 === 0 ? 32 : 0,
            borderTopRightRadius: index % 2 === 0 ? 0 : 32,
            transform: [{ rotate: index % 2 === 0 ? "28deg" : "-28deg" }],
            opacity: 0.62,
          }}
        />
      ))}
      {[0, 1, 2].map((index) => (
        <View
          key={`dot-${index}`}
          className="absolute rounded-full border border-gold-dark"
          style={{
            width: 12,
            height: 12,
            left: 50 + index * 23,
            top: 8 + index * 43,
            opacity: 0.78,
          }}
        />
      ))}
    </View>
  );
}

function MobilePaperMotif() {
  return (
    <View pointerEvents="none" className="overflow-hidden" style={{ height: 92 }}>
      <View
        className="absolute bg-surface-low"
        style={{
          left: -42,
          right: -28,
          top: 0,
          height: 68,
          borderBottomLeftRadius: 180,
          borderBottomRightRadius: 120,
          transform: [{ rotate: "4deg" }],
        }}
      />
      <View
        className="absolute bottom-0 left-0 right-0 bg-primary"
        style={{
          height: 50,
          borderTopLeftRadius: 120,
          borderTopRightRadius: 120,
        }}
      />
    </View>
  );
}
