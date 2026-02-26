import { View } from "react-native";
import { StatusBar } from "expo-status-bar";
import ProfileScreen from "../../src/components/profile/ProfileScreen";
import { useSettings } from "../../src/context/SettingsContext";

export default function ProfileTab() {
  const { colorScheme } = useSettings();

  return (
    <View className="flex-1 pt-12">
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <ProfileScreen />
    </View>
  );
}
