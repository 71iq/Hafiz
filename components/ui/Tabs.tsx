import { View, Pressable, Text, ScrollView, type ViewProps } from "react-native";
import { cn } from "@/lib/utils";
import { useState } from "react";

type Tab = {
  key: string;
  label: string;
};

type TabsProps = ViewProps & {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  scrollable?: boolean;
};

/**
 * Horizontal tab bar with tonal active indicator.
 * No bottom border — uses tonal background shift per DESIGN.md.
 */
export function TabBar({
  tabs,
  activeTab,
  onTabChange,
  scrollable,
  className,
  ...props
}: TabsProps) {
  const Wrapper = scrollable ? ScrollView : View;
  const wrapperProps = scrollable
    ? { horizontal: true, showsHorizontalScrollIndicator: false }
    : {};

  return (
    <Wrapper
      {...wrapperProps}
      className={cn("bg-surface-low dark:bg-surface-dark-low", className)}
      {...props}
    >
      <View className="flex-row px-4 gap-1">
        {tabs.map((tab) => {
          const active = tab.key === activeTab;
          return (
            <Pressable
              key={tab.key}
              onPress={() => onTabChange(tab.key)}
              className={cn(
                "py-3 px-4 rounded-full",
                active && "bg-primary-accent/10 dark:bg-primary-bright/10"
              )}
            >
              <Text
                className={cn(
                  "font-manrope-semibold text-sm text-center",
                  active
                    ? "text-primary-accent dark:text-primary-bright"
                    : "text-warm-400 dark:text-neutral-500"
                )}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Wrapper>
  );
}
