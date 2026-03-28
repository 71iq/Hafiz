import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { View, Text, Pressable, StyleSheet, type ViewStyle } from "react-native";
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
    backgroundColor: "#FFF8F1", // surface
  },
  iconWrapper: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#F9F3EB", // surface-low
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  button: {
    height: 44,
    paddingHorizontal: 24,
    borderRadius: 9999, // pill
    backgroundColor: "#0d9488", // primary-accent (teal-600)
    alignItems: "center",
    justifyContent: "center",
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
});

const textStyles = StyleSheet.create({
  title: {
    fontFamily: "Manrope_600SemiBold",
    fontSize: 18,
    lineHeight: 26,
    color: "#2D2D2D", // charcoal
    textAlign: "center",
    marginBottom: 6,
  },
  subtitle: {
    fontFamily: "Manrope_400Regular",
    fontSize: 14,
    lineHeight: 20,
    color: "#8a7058", // warm-600 — muted body text
    textAlign: "center",
    marginBottom: 28,
  },
  buttonText: {
    fontFamily: "Manrope_600SemiBold",
    fontSize: 15,
    color: "#FFFFFF",
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

    return (
      <View style={viewStyles.container}>
        <View style={viewStyles.iconWrapper}>
          <AlertTriangle size={40} color="#8a7058" strokeWidth={1.5} />
        </View>

        <Text style={textStyles.title}>Something went wrong</Text>
        <Text style={textStyles.subtitle}>
          This section couldn't load properly
        </Text>

        <Pressable
          onPress={this.handleReset}
          style={({ pressed }): ViewStyle =>
            pressed
              ? { ...viewStyles.button, ...viewStyles.buttonPressed }
              : viewStyles.button
          }
        >
          <Text style={textStyles.buttonText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }
}

// ---------------------------------------------------------------------------
// HOC wrapper for functional components
// ---------------------------------------------------------------------------

/**
 * Wrap any component in an ErrorBoundary.
 *
 * ```tsx
 * export default withErrorBoundary(MyScreen, "MyScreen");
 * ```
 */
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  sectionName?: string,
) {
  const displayName =
    WrappedComponent.displayName || WrappedComponent.name || "Component";

  const Wrapped = (props: P) => (
    <ErrorBoundary section={sectionName ?? displayName}>
      <WrappedComponent {...props} />
    </ErrorBoundary>
  );

  Wrapped.displayName = `withErrorBoundary(${displayName})`;
  return Wrapped;
}
