import { View, Text, Pressable } from "react-native";

interface GradingButtonsProps {
  intervals: number[];
  onGrade: (grade: number) => void;
}

const BUTTONS = [
  { grade: 0, label: "Again", color: "bg-red-600 active:bg-red-700" },
  { grade: 1, label: "Hard", color: "bg-orange-500 active:bg-orange-600" },
  { grade: 2, label: "Good", color: "bg-blue-600 active:bg-blue-700" },
  { grade: 3, label: "Easy", color: "bg-green-600 active:bg-green-700" },
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
        <Pressable
          key={btn.grade}
          onPress={() => onGrade(btn.grade)}
          className={`flex-1 items-center py-3 rounded-xl ${btn.color}`}
        >
          <Text className="text-white font-semibold text-sm">{btn.label}</Text>
          <Text className="text-white/70 text-xs mt-0.5">
            {formatInterval(intervals[btn.grade])}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
