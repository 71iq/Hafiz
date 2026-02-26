import { View } from "react-native";
import { StatusBar } from "expo-status-bar";
import SearchScreen from "../../src/components/search/SearchScreen";
import { useSettings } from "../../src/context/SettingsContext";

export default function SearchTab() {
  const { colorScheme } = useSettings();

  return (
    <View className="flex-1 pt-12">
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <SearchScreen />
    </View>
  );
}
