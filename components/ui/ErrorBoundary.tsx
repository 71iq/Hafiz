import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { View, StyleSheet } from "react-native";
import { EmptyState } from "@/components/ui/EmptyState";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { AlertTriangle } from "lucide-react-native";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional custom fallback UI rendered when an error is caught. */
  fallback?: ReactNode;
  /** Section name used for logging context (e.g. "Mushaf", "Flashcards"). */
  section?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// ---------------------------------------------------------------------------
// Styles — StyleSheet because class components cannot use hooks (NativeWind).
// Follows "The Serene Path" design tokens: warm neutrals, teal accent, no
// borders, pill shapes, tonal layering, Manrope font family.
// ---------------------------------------------------------------------------

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

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    // Custom fallback takes precedence when provided.
    if (this.props.fallback) {
      return this.props.fallback;
    }

    return <ErrorFallback onReset={this.handleReset} />;
  }
}

// The fallback reads strings and theme through hooks, so it follows the app language and dark themes;
// the class body drew fixed English text in a fixed dark colour.
function ErrorFallback({ onReset }: { onReset: () => void }) {
  const s = useStrings();
  const { isDark } = useSettings();
  return (
    <View className="bg-surface dark:bg-surface-dark" style={viewStyles.container}>
      <EmptyState
        icon={AlertTriangle}
        title={s.errorTitle}
        subtitle={s.errorSubtitle}
        actionLabel={s.errorTryAgain}
        onAction={onReset}
        isDark={isDark}
      />
    </View>
  );
}
