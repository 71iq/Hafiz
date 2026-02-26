import { View } from "react-native";
import { Button } from "../ui/button";
import { Text } from "../ui/text";
import { Card, CardContent } from "../ui/card";

export interface SessionStats {
  total: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
}

interface SessionSummaryProps {
  stats: SessionStats;
  onReturn: () => void;
}

export default function SessionSummary({ stats, onReturn }: SessionSummaryProps) {
  return (
    <View className="flex-1 bg-background items-center justify-center px-6">
      <Text className="text-2xl font-bold text-foreground mb-6">
        Session Complete
      </Text>

      <Card className="w-full mb-8">
        <CardContent>
          <Text className="text-center text-3xl font-bold text-primary mb-4">
            {stats.total}
          </Text>
          <Text variant="muted" className="text-center text-sm mb-6">
            Cards Reviewed
          </Text>

          <View className="flex-row justify-around">
            <StatBadge label="Again" count={stats.again} color="text-destructive" />
            <StatBadge label="Hard" count={stats.hard} color="text-warning" />
            <StatBadge label="Good" count={stats.good} color="text-primary" />
            <StatBadge label="Easy" count={stats.easy} color="text-success" />
          </View>
        </CardContent>
      </Card>

      <Button size="lg" onPress={onReturn}>
        Return to Deck Selector
      </Button>
    </View>
  );
}

function StatBadge({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <View className="items-center">
      <Text className={`text-xl font-bold ${color}`}>{count}</Text>
      <Text variant="muted" className="text-xs mt-1">{label}</Text>
    </View>
  );
}
