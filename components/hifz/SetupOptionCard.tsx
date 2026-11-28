import { Pressable } from "react-native";
import { Text } from "@/components/ui/Text";

/** One choice in a setup step's radio group: a title and an optional hint, tinted when chosen. */
export function SetupOptionCard({
  title,
  hint,
  selected,
  onPress,
}: {
  title: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      // React Native Web ignores accessibilityState, so the web export reads the choice from aria-checked.
      aria-checked={selected}
      onPress={onPress}
      className={`min-h-[56px] justify-center rounded-3xl px-4 py-3 ${selected ? "bg-primary-accent/10 dark:bg-primary-bright/15 border border-primary-accent dark:border-primary-bright" : "bg-surface-low dark:bg-surface-dark-low border border-transparent"}`}
    >
      <Text
        style={{ fontFamily: "Manrope_700Bold", fontSize: 15 }}
        className={selected ? "text-primary-muted dark:text-primary-bright" : "text-charcoal dark:text-neutral-100"}
      >
        {title}
      </Text>
      {hint ? (
        // Readable on the selected teal tint in both themes; the shared caption tone is lighter.
        <Text variant="caption" className="mt-0.5 text-warm-700 dark:text-neutral-400" style={{ lineHeight: 18 }}>
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}
