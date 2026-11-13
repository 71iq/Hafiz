import { Pressable, View } from "react-native";
import { Flame, LogOut, Users } from "lucide-react-native";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { Card } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import type { BoardStanding, BoardView } from "@/lib/board/api";
import { formatDays } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { formatSocialDate, socialNumber } from "@/lib/social/text";
import { socialRowStyle, useSocialAccent } from "./SocialControls";

type Language = "en" | "ar";
type JoinedView = Exclude<BoardView, { status: "not_joined" }>;

/**
 * BRD-05 and BRD-08: this week's cohort. Standings show only once the group has enough people; each
 * row is a name or nickname, weekly consistency points and streak. Leaving is one tap (BRD-04).
 */
export function BoardStandings({
  view,
  leaving,
  onLeave,
}: {
  view: JoinedView;
  leaving: boolean;
  onLeave: () => void;
}) {
  const s = useStrings();
  const { isRTL, uiLanguage } = useSettings();
  const language: Language = uiLanguage === "ar" ? "ar" : "en";
  const { accent, muted } = useSocialAccent();

  return (
    <View className="gap-4">
      <View className="items-center justify-between gap-3" style={socialRowStyle(isRTL)}>
        <Text variant="label-lg" className="text-warm-500 dark:text-neutral-400">
          {interpolate(s.boardWeekOf, { date: formatSocialDate(view.weekStart, language) })}
        </Text>
        <Text variant="label-lg" className="text-warm-500 dark:text-neutral-400">
          {interpolate(s.boardGroupSize, { n: socialNumber(view.memberCount, language) })}
        </Text>
      </View>

      {view.status === "gathering" ? (
        <Card elevation="low" className="items-center gap-3 p-6">
          <View className="h-14 w-14 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/15">
            <Users size={24} color={accent} />
          </View>
          <Text variant="title-lg" align="center">
            {s.boardGatheringTitle}
          </Text>
          <Text variant="body-sm" align="center">
            {interpolate(s.boardGatheringBody, {
              n: socialNumber(view.memberCount, language),
              min: socialNumber(view.minMembers, language),
            })}
          </Text>
        </Card>
      ) : (
        <View className="gap-2.5">
          {view.standings.map((standing, index) => (
            <StandingRow key={`${standing.rank}-${index}`} standing={standing} language={language} s={s} />
          ))}
        </View>
      )}

      <Text variant="caption">{s.boardRules}</Text>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: leaving, busy: leaving }}
        disabled={leaving}
        onPress={onLeave}
        className="min-h-11 items-center justify-center gap-2 self-center px-4"
        style={[socialRowStyle(isRTL), { opacity: leaving ? 0.6 : 1 }]}
      >
        <LogOut size={16} color={muted} />
        <Text variant="label-lg" className="text-warm-500 dark:text-neutral-400">
          {s.boardLeave}
        </Text>
      </Pressable>
    </View>
  );
}

function StandingRow({ standing, language, s }: { standing: BoardStanding; language: Language; s: UIStrings }) {
  const { isDark, isRTL } = useSettings();
  const { accent } = useSocialAccent();
  const label = interpolate(s.boardPointsA11y, {
    name: standing.isMe ? `${standing.name} (${s.boardYou})` : standing.name,
    rank: socialNumber(standing.rank, language),
    points: socialNumber(standing.points, language),
    streak: formatDays(standing.streak, language),
  });
  return (
    <View
      accessible
      accessibilityLabel={label}
      className={
        standing.isMe
          ? "items-center gap-3 rounded-3xl border border-primary-accent/30 bg-primary-accent/10 px-4 py-3 dark:border-primary-bright/30 dark:bg-primary-bright/10"
          : "items-center gap-3 rounded-3xl bg-surface-low px-4 py-3 dark:bg-surface-dark-low"
      }
      style={socialRowStyle(isRTL)}
    >
      <View className="h-9 w-9 items-center justify-center rounded-full bg-surface-mid dark:bg-surface-dark-mid">
        <Text variant="title-sm">{socialNumber(standing.rank, language)}</Text>
      </View>
      <ProfileAvatar avatarUrl={standing.avatarUrl} name={standing.name} size={36} isDark={isDark} />
      <View className="min-w-0 flex-1">
        <Text variant="title-sm" numberOfLines={1}>
          {standing.name}
          {standing.isMe ? ` · ${s.boardYou}` : ""}
        </Text>
        <View className="items-center gap-1" style={socialRowStyle(isRTL)}>
          <Flame size={12} color={accent} />
          <Text variant="caption">{formatDays(standing.streak, language)}</Text>
        </View>
      </View>
      <View className="items-center">
        <Text variant="title-lg">{socialNumber(standing.points, language)}</Text>
        <Text variant="label-sm" className="text-warm-500 dark:text-neutral-400">
          {s.boardPoints}
        </Text>
      </View>
    </View>
  );
}
