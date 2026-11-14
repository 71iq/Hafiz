import { Pressable, View } from "react-native";
import {
  BookCheck,
  CalendarCheck2,
  ClipboardList,
  Eye,
  GraduationCap,
  HandHeart,
  LogOut,
  Share2,
  UserMinus,
} from "lucide-react-native";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import type { HalaqaDetail, HalaqaMember, ReceivedEncouragement } from "@/lib/halaqa/api";
import { formatDays } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { encouragementText } from "@/lib/social/encouragements";
import { socialNumber } from "@/lib/social/text";
import { socialRowStyle, useSocialAccent } from "./SocialControls";

type Language = "en" | "ar";

/**
 * One halaqa: the shared weekly goal (SOC-07), members with their shared consistency (SOC-02),
 * one-tap encouragement (SOC-06), teacher roles (SOC-03), invite sharing and leaving. No member
 * ranking anywhere.
 */
export function HalaqaGroup({
  detail,
  rolePending,
  onEncourage,
  onTeacherView,
  onChangeRole,
  onShareCode,
  onOpenSharing,
  onLeave,
}: {
  detail: HalaqaDetail;
  /** A role change is saving; the role controls wait for it. */
  rolePending: boolean;
  onEncourage: (member: HalaqaMember) => void;
  onTeacherView: (member: HalaqaMember) => void;
  onChangeRole: (member: HalaqaMember) => void;
  onShareCode: (code: string) => void;
  onOpenSharing: () => void;
  onLeave: () => void;
}) {
  const s = useStrings();
  const { isRTL, uiLanguage } = useSettings();
  const language: Language = uiLanguage === "ar" ? "ar" : "en";
  const { accent, muted } = useSocialAccent();
  const { group, goal } = detail;
  const title = group.kind === "matched" ? s.halaqaMatchedName : (group.name ?? s.halaqaMatchedName);
  // SOC-03: only an invite halaqa's creator assigns teachers, as the server checks. Their own role is
  // chosen when they create it.
  const managesRoles = group.kind === "invite" && group.isCreator;

  return (
    <View className="gap-4">
      <Card elevation="low" className="gap-4 p-5">
        <View className="gap-1">
          <Text variant="display-sm" accessibilityRole="header">
            {title}
          </Text>
          <Text variant="caption">
            {interpolate(s.halaqaMemberCount, { n: socialNumber(group.memberCount, language) })}
            {group.role === "teacher" ? ` · ${s.halaqaTeacherBadge}` : ""}
          </Text>
        </View>

        {/* ETH-06, ETH-07: what is shared is named in words, one tap from the group. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={s.halaqaSharingA11y}
          onPress={onOpenSharing}
          className="-my-1 min-h-11 items-center gap-2 self-start"
          style={socialRowStyle(isRTL)}
        >
          <Eye size={16} color={accent} />
          <Text variant="label-lg" className="text-primary-accent dark:text-primary-bright">
            {s.halaqaSharingTitle}
          </Text>
        </Pressable>

        {group.inviteCode ? (
          <View className="items-center gap-3" style={socialRowStyle(isRTL)}>
            <View className="min-w-0 flex-1">
              <Text variant="label-md" className="text-warm-500 dark:text-neutral-400">
                {s.halaqaInviteCode}
              </Text>
              {/* The code reads left to right in both languages and sits at the interface's start edge. */}
              <Text variant="title-lg" selectable dir="ltr" align={isRTL ? "end" : "start"} style={{ letterSpacing: 2 }}>
                {group.inviteCode}
              </Text>
            </View>
            <Button variant="outline" className="border border-warm-300 dark:border-neutral-700" onPress={() => onShareCode(group.inviteCode ?? "")}>
              <View className="items-center gap-2" style={socialRowStyle(isRTL)}>
                <Share2 size={16} color={accent} />
                <Text variant="title-sm">{s.halaqaShareCode}</Text>
              </View>
            </Button>
          </View>
        ) : null}

        <GoalBar wirdDays={goal.wirdDays} target={goal.target} language={language} s={s} />
      </Card>

      {detail.received.length > 0 ? (
        <Card elevation="low" className="gap-3 p-5">
          <Text variant="title-md">{s.halaqaReceived}</Text>
          {detail.received.map((item) => (
            <ReceivedRow key={item.id} item={item} s={s} />
          ))}
        </Card>
      ) : null}

      <View className="gap-2.5">
        {detail.members.map((member) => (
          <MemberRow
            key={member.userId}
            member={member}
            language={language}
            s={s}
            canChangeRole={managesRoles && !member.isMe}
            rolePending={rolePending}
            onEncourage={() => onEncourage(member)}
            onTeacherView={() => onTeacherView(member)}
            onChangeRole={() => onChangeRole(member)}
          />
        ))}
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={onLeave}
        className="min-h-11 items-center justify-center gap-2 self-center px-4"
        style={socialRowStyle(isRTL)}
      >
        <LogOut size={16} color={muted} />
        <Text variant="label-lg" className="text-warm-500 dark:text-neutral-400">
          {s.halaqaLeave}
        </Text>
      </Pressable>
    </View>
  );
}

function GoalBar({ wirdDays, target, language, s }: { wirdDays: number; target: number; language: Language; s: UIStrings }) {
  const { isRTL } = useSettings();
  const ratio = target > 0 ? Math.min(1, wirdDays / target) : 0;
  const reached = target > 0 && wirdDays >= target;
  return (
    <View className="gap-2">
      <View className="items-baseline justify-between gap-2" style={socialRowStyle(isRTL)}>
        <Text variant="title-sm">{s.halaqaWeeklyGoal}</Text>
        <Text variant="label-md" className="text-warm-500 dark:text-neutral-400">
          {interpolate(s.halaqaGoalProgress, {
            done: socialNumber(wirdDays, language),
            target: socialNumber(target, language),
          })}
        </Text>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={s.halaqaWeeklyGoal}
        accessibilityValue={{ min: 0, max: target, now: Math.min(wirdDays, target) }}
        className="h-3 overflow-hidden rounded-full bg-surface-high dark:bg-surface-dark-high"
        style={socialRowStyle(isRTL)}
      >
        <View className="h-full rounded-full bg-primary-accent dark:bg-primary-bright" style={{ width: `${ratio * 100}%` }} />
      </View>
      <Text variant="caption">{reached ? s.halaqaGoalReached : s.halaqaGoalNote}</Text>
    </View>
  );
}

function WeekDots({ week, s, language }: { week: boolean[]; s: UIStrings; language: Language }) {
  const { isRTL } = useSettings();
  const done = week.filter(Boolean).length;
  return (
    <View
      accessible
      accessibilityLabel={interpolate(s.halaqaWeekA11y, { n: socialNumber(done, language) })}
      className="items-center gap-1.5"
      style={socialRowStyle(isRTL)}
    >
      {week.map((filled, index) => (
        // A day without a wird is a neutral outline, never "missed" (SB-03).
        <View
          key={index}
          className={
            filled
              ? "h-3 w-3 rounded-full bg-primary-accent dark:bg-primary-bright"
              : "h-3 w-3 rounded-full border border-warm-300 dark:border-neutral-600"
          }
        />
      ))}
    </View>
  );
}

function MemberRow({
  member,
  language,
  s,
  canChangeRole,
  rolePending,
  onEncourage,
  onTeacherView,
  onChangeRole,
}: {
  member: HalaqaMember;
  language: Language;
  s: UIStrings;
  canChangeRole: boolean;
  rolePending: boolean;
  onEncourage: () => void;
  onTeacherView: () => void;
  onChangeRole: () => void;
}) {
  const { isDark, isRTL } = useSettings();
  const { accent, muted } = useSocialAccent();
  const shared = member.week !== null || member.streak !== null || member.juzCompletions !== null;
  const isTeacher = member.role === "teacher";
  return (
    <Card elevation="low" className="gap-3 px-4 py-3.5">
      <View className="items-center gap-3" style={socialRowStyle(isRTL)}>
        <ProfileAvatar avatarUrl={member.avatarUrl} name={member.name} size={40} isDark={isDark} />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text variant="title-sm" numberOfLines={1}>
            {member.name}
            {member.isMe ? ` · ${s.halaqaYou}` : ""}
          </Text>
          {member.role === "teacher" ? (
            <Text variant="label-md" className="text-primary-accent dark:text-primary-bright">
              {s.halaqaTeacherBadge}
            </Text>
          ) : null}
        </View>
        {!member.isMe ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={interpolate(s.halaqaEncourageA11y, { name: member.name })}
            accessibilityState={{ disabled: member.encouragedToday }}
            disabled={member.encouragedToday}
            onPress={onEncourage}
            className="min-h-11 items-center justify-center gap-1.5 rounded-full px-3"
            style={[socialRowStyle(isRTL), { opacity: member.encouragedToday ? 0.6 : 1 }]}
          >
            <HandHeart size={18} color={member.encouragedToday ? muted : accent} />
            <Text variant="label-md">{member.encouragedToday ? s.halaqaEncouraged : s.halaqaEncourage}</Text>
          </Pressable>
        ) : null}
      </View>

      {shared ? (
        <View className="flex-wrap items-center gap-x-4 gap-y-2" style={socialRowStyle(isRTL)}>
          {member.week ? <WeekDots week={member.week} s={s} language={language} /> : null}
          {member.streak !== null ? (
            <View className="items-center gap-1" style={socialRowStyle(isRTL)}>
              <CalendarCheck2 size={14} color={accent} />
              <Text variant="label-md">{interpolate(s.halaqaStreak, { days: formatDays(member.streak, language) })}</Text>
            </View>
          ) : null}
          {member.juzCompletions !== null ? (
            <View className="items-center gap-1" style={socialRowStyle(isRTL)}>
              <BookCheck size={14} color={accent} />
              <Text variant="label-md">
                {interpolate(s.halaqaJuz, { n: socialNumber(member.juzCompletions, language) })}
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        <Text variant="caption">{s.halaqaNotShared}</Text>
      )}

      {member.canOpenTeacherView || canChangeRole ? (
        <View className="flex-wrap items-center gap-x-5" style={socialRowStyle(isRTL)}>
          {member.canOpenTeacherView ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={interpolate(s.halaqaTeacherViewA11y, { name: member.name })}
              onPress={onTeacherView}
              className="min-h-11 items-center gap-2"
              style={socialRowStyle(isRTL)}
            >
              <ClipboardList size={16} color={accent} />
              <Text variant="label-lg" className="text-primary-accent dark:text-primary-bright">
                {s.halaqaTeacherView}
              </Text>
            </Pressable>
          ) : null}
          {canChangeRole ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={interpolate(isTeacher ? s.halaqaRemoveTeacherA11y : s.halaqaMakeTeacherA11y, {
                name: member.name,
              })}
              accessibilityState={{ disabled: rolePending }}
              disabled={rolePending}
              onPress={onChangeRole}
              className="min-h-11 items-center gap-2"
              style={[socialRowStyle(isRTL), { opacity: rolePending ? 0.6 : 1 }]}
            >
              {isTeacher ? <UserMinus size={16} color={muted} /> : <GraduationCap size={16} color={accent} />}
              <Text
                variant="label-lg"
                className={
                  isTeacher ? "text-warm-500 dark:text-neutral-400" : "text-primary-accent dark:text-primary-bright"
                }
              >
                {isTeacher ? s.halaqaRemoveTeacher : s.halaqaMakeTeacher}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function ReceivedRow({ item, s }: { item: ReceivedEncouragement; s: UIStrings }) {
  const { isRTL } = useSettings();
  const { accent } = useSocialAccent();
  return (
    <View className="items-start gap-3" style={socialRowStyle(isRTL)}>
      <HandHeart size={18} color={accent} />
      <View className="min-w-0 flex-1 gap-0.5">
        {/* Free text is shown as written; fixed templates render in this reader's language (MAT-01). */}
        <Text variant="body-sm">{item.body ?? encouragementText(item.templateId, s)}</Text>
        {item.fromName ? (
          <Text variant="caption">{interpolate(s.halaqaReceivedFrom, { name: item.fromName })}</Text>
        ) : null}
      </View>
    </View>
  );
}
