import { View } from "react-native";
import { Button } from "../ui/button";
import { Text } from "../ui/text";

interface GradingButtonsProps {
  intervals: number[];
  onGrade: (grade: number) => void;
}

const BUTTONS = [
  { grade: 0, label: "Again", variant: "destructive" as const },
  { grade: 1, label: "Hard", variant: "warning" as const },
  { grade: 2, label: "Good", variant: "default" as const },
  { grade: 3, label: "Easy", variant: "success" as const },
] as const;

function formatInterval(days: number): string {
  if (days === 0) return "<1d";
  if (days === 1) return "1d";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

export default function GradingButtons({ intervals, onGrade }: GradingButtonsProps) {
  return (
    <View className="flex-row gap-2 px-4 pb-4">
      {BUTTONS.map((btn) => (
        <Button
          key={btn.grade}
          variant={btn.variant}
          onPress={() => onGrade(btn.grade)}
          className="flex-1 flex-col py-3"
        >
          <Text className="text-white font-semibold text-sm">{btn.label}</Text>
          <Text className="text-white/70 text-xs mt-0.5">
            {formatInterval(intervals[btn.grade])}
          </Text>
        </Button>
      ))}
    </View>
  );
}
