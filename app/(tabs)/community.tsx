import { SafeAreaView } from "react-native";
import CommunityScreen from "../../src/components/community/CommunityScreen";

export default function CommunityTab() {
  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-gray-950">
      <CommunityScreen />
    </SafeAreaView>
  );
}
