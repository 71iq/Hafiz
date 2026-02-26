import { View } from "react-native";
import { useSettings } from "../context/SettingsContext";
import { Button } from "./ui/button";
import { Text } from "./ui/text";
import { Toggle } from "./ui/toggle";
import { AArrowDown, AArrowUp, Eye, EyeOff, Moon, Sun } from "lucide-react-native";

interface ControlBarProps {
  currentSurahName: string;
  onSurahPickerOpen: () => void;
}

export default function ControlBar({
  currentSurahName,
  onSurahPickerOpen,
}: ControlBarProps) {
  const { increaseFontSize, decreaseFontSize, hideAyahs, toggleHideAyahs, toggleDarkMode, colorScheme } =
    useSettings();
  const isDark = colorScheme === "dark";
  const iconColor = isDark ? "hsl(220, 9%, 55%)" : "hsl(220, 9%, 46%)";

  return (
    <View className="flex-row items-center justify-between px-3 py-2 bg-muted border-b border-border">
      <Button
        variant="ghost"
        onPress={onSurahPickerOpen}
        className="flex-1 mr-2 justify-start"
      >
        <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
          {currentSurahName || "Select Surah"}
        </Text>
      </Button>

      <View className="flex-row items-center gap-1">
        <Button variant="ghost" size="icon" onPress={decreaseFontSize} title="Decrease font size">
          <AArrowDown size={18} color={iconColor} />
        </Button>

        <Button variant="ghost" size="icon" onPress={increaseFontSize} title="Increase font size">
          <AArrowUp size={18} color={iconColor} />
        </Button>

        <Toggle pressed={hideAyahs} onPress={toggleHideAyahs} title={hideAyahs ? "Show ayahs" : "Hide ayahs"}>
          {hideAyahs ? <EyeOff size={18} color={iconColor} /> : <Eye size={18} color={iconColor} />}
        </Toggle>

        <Button variant="ghost" size="icon" onPress={toggleDarkMode} title={isDark ? "Switch to light mode" : "Switch to dark mode"}>
          {isDark ? <Sun size={18} color={iconColor} /> : <Moon size={18} color={iconColor} />}
        </Button>
      </View>
    </View>
  );
}
