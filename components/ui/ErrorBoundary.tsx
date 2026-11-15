import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { AlertTriangle } from "lucide-react-native";
import { EmptyState } from "@/components/ui/EmptyState";
import { useStrings } from "@/lib/i18n/useStrings";
import type { UIStrings } from "@/lib/i18n/strings";
import { useSettings } from "@/lib/settings/context";
import { errorIconColor } from "@/lib/ui/theme-icons";

// The support contact published on the About and Terms pages.
export const SUPPORT_CONTACT_URL = "mailto:support@hafizquran.app";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional custom fallback UI rendered when an error is caught. */
  fallback?: ReactNode;
  /** Section name used for logging context (e.g. "Mushaf", "Flashcards"). */
  section?: string;
  /**
   * "screen" fills its route with Retry, Go to Home and the support link. "section" is a smaller
   * inline card for a boundary around one part of a screen or sheet, so the surrounding controls
   * (including a sheet's close button) keep working.
   */
  variant?: "screen" | "section";
  /** Strings for a boundary outside the settings provider (the root route fallback). */
  strings?: UIStrings;
  /** Shows the Go to Home action. Off where Home is not reachable or not meaningful. */
  showHome?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

const viewStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingVertical: 48,
  },
});

// ---------------------------------------------------------------------------
// ErrorBoundary (class component — React requirement for error boundaries)
// ---------------------------------------------------------------------------

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const section = this.props.section ?? "unknown";
    console.error(`[ErrorBoundary:${section}]`, error, info.componentStack);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleHome = () => {
    this.setState({ hasError: false, error: null });
    // The root entry decides between onboarding and Home.
    router.replace("/");
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    // Custom fallback takes precedence when provided.
    if (this.props.fallback) {
      return this.props.fallback;
    }

    return (
      <ErrorFallback
        onReset={this.handleReset}
        onHome={this.props.showHome === false ? undefined : this.handleHome}
        variant={this.props.variant ?? "screen"}
        strings={this.props.strings}
      />
    );
  }
}

/** The route fallback outside the providers reads the startup strings it is given. */
export function RouteErrorFallback({
  strings,
  onRetry,
}: {
  strings: UIStrings;
  onRetry: () => void;
}) {
  return <ErrorFallback onReset={onRetry} onHome={() => router.replace("/")} variant="screen" strings={strings} />;
}

// The fallback reads strings and theme through hooks, so it follows the app language and dark themes;
// the class body drew fixed English text in a fixed dark colour.
function ErrorFallback({
  onReset,
  onHome,
  variant,
  strings: providedStrings,
}: {
  onReset: () => void;
  onHome?: () => void;
  variant: "screen" | "section";
  strings?: UIStrings;
}) {
  const contextStrings = useStrings();
  const s = providedStrings ?? contextStrings;
  const { isDark, effectiveTheme } = useSettings();
  const palette = effectiveTheme ?? (isDark ? "dark" : "beige");
  const openSupport = () => {
    Linking.openURL(SUPPORT_CONTACT_URL).catch(() => {});
  };
  const supportLink = (
    <Pressable
      onPress={openSupport}
      accessibilityRole="link"
      className="mt-2 min-h-11 items-center justify-center px-3"
    >
      <Text
        className="text-center text-warm-700 underline dark:text-neutral-300"
        style={{ fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 19 }}
      >
        {s.errorReportProblem}
      </Text>
    </Pressable>
  );

  if (variant === "section") {
    return (
      <View
        accessibilityRole="alert"
        className="m-4 items-center rounded-3xl bg-surface-low px-5 py-5 dark:bg-surface-dark-low"
      >
        <AlertTriangle size={22} color={errorIconColor(palette)} strokeWidth={1.75} />
        <Text
          className="mt-2 text-center text-charcoal dark:text-neutral-200"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, lineHeight: 22 }}
        >
          {s.errorSectionTitle}
        </Text>
        <Pressable
          onPress={onReset}
          accessibilityRole="button"
          className="mt-3 min-h-11 items-center justify-center rounded-full bg-primary-muted px-5 dark:bg-primary-bright"
        >
          <Text className="text-white dark:text-primary" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
            {s.errorTryAgain}
          </Text>
        </Pressable>
        {supportLink}
      </View>
    );
  }

  return (
    <View className="bg-surface dark:bg-surface-dark" style={viewStyles.container}>
      <EmptyState
        icon={AlertTriangle}
        tone="error"
        title={s.errorTitle}
        subtitle={s.errorSubtitle}
        actionLabel={s.errorTryAgain}
        onAction={onReset}
        isDark={isDark}
      />
      {onHome ? (
        <Pressable
          onPress={onHome}
          accessibilityRole="button"
          className="-mt-8 min-h-11 items-center justify-center rounded-full bg-surface-high px-6 dark:bg-surface-dark-high"
        >
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
          >
            {s.errorGoHome}
          </Text>
        </Pressable>
      ) : null}
      {supportLink}
    </View>
  );
}
