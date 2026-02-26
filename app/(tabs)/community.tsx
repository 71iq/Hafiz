import { SafeAreaView } from "react-native";
import CommunityScreen from "../../src/components/community/CommunityScreen";

export default function CommunityTab() {
  return (
    <SafeAreaView className="flex-1 bg-background">
      <CommunityScreen />
    </SafeAreaView>
  );
}
