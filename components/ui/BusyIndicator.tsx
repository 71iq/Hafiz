import { ActivityIndicator, View } from "react-native";
import { LoaderCircle } from "lucide-react-native";
import { useReducedMotionPreference } from "@/lib/ui/reduced-motion";

type Props = { size: number | "small"; color: string };

/** Keep busy feedback visible when the system disables motion. */
export function BusyIndicator({ size, color }: Props) {
  const reduceMotion = useReducedMotionPreference();
  if (!reduceMotion) return <ActivityIndicator size={size} color={color} />;
  const extent = size === "small" ? 20 : size;
  return (
    <View
      accessibilityRole="progressbar"
      style={{ width: extent, height: extent, alignItems: "center", justifyContent: "center" }}
    >
      <LoaderCircle size={extent} color={color} />
    </View>
  );
}
