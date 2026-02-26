import { View } from "react-native";
import { StatusBar } from "expo-status-bar";
import MushafScreen from "../../src/components/MushafScreen";
import { useSettings } from "../../src/context/SettingsContext";

export default function HomeScreen() {
  const { colorScheme } = useSettings();

  return (
    <View className="flex-1 pt-12">
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <MushafScreen />
    </View>
  );
}
