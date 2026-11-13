import { useState } from "react";
import { View } from "react-native";
import { ChevronDown, ChevronUp, Trophy } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { DisclosureRow } from "@/components/ui/MirroredRow";
import { Text } from "@/components/ui/Text";
import { BOARD_NICKNAME_MAX, isValidBoardNickname, normalizeBoardNickname } from "@/lib/board/api";
import { useStrings } from "@/lib/i18n/useStrings";
import { SocialErrorText, SocialToggleRow, useSocialAccent } from "./SocialControls";

/**
 * BRD-04 and BRD-07: the Board is off until joined here, after a note on intention citing Bukhari 1.
 * A nickname is optional, and required for under 18s, who never appear with a photo.
 */
export function BoardJoin({
  initialNickname,
  initialIsMinor,
  pending,
  error,
  onJoin,
}: {
  initialNickname: string | null;
  initialIsMinor: boolean;
  pending: boolean;
  error: string | null;
  onJoin: (choice: { nickname: string | null; isMinor: boolean }) => void;
}) {
  const s = useStrings();
  const { accent, muted } = useSocialAccent();
  const [rulesOpen, setRulesOpen] = useState(false);
  const [useNickname, setUseNickname] = useState(initialNickname !== null || initialIsMinor);
  const [nickname, setNickname] = useState(initialNickname ?? "");
  const [isMinor, setIsMinor] = useState(initialIsMinor);
  const nicknameRequired = isMinor;
  const nicknameOn = useNickname || nicknameRequired;
  const chosenNickname = nicknameOn ? normalizeBoardNickname(nickname) : null;
  const nicknameValid = nicknameOn ? chosenNickname !== null && isValidBoardNickname(chosenNickname) : true;

  return (
    <Card elevation="low" className="gap-4 p-6">
      <View className="items-center gap-3">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/15">
          <Trophy size={28} color={accent} />
        </View>
        <Text variant="headline" align="center" accessibilityRole="header">
          {s.boardIntentionTitle}
        </Text>
      </View>
      <Text variant="body" className="text-warm-700 dark:text-neutral-300">
        {s.boardIntentionBody}
      </Text>
      <Text variant="body-sm">{s.boardIntentionPrivacy}</Text>
      <View>
        <DisclosureRow
          onPress={() => setRulesOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: rulesOpen }}
          className="min-h-11"
          trailing={rulesOpen ? <ChevronUp size={18} color={muted} /> : <ChevronDown size={18} color={muted} />}
        >
          <Text variant="title-sm">{s.boardHowPoints}</Text>
        </DisclosureRow>
        {rulesOpen ? <Text variant="body-sm">{s.boardRules}</Text> : null}
      </View>

      <View className="gap-1">
        <SocialToggleRow
          label={s.boardMinorToggle}
          hint={s.boardMinorHint}
          value={isMinor}
          onValueChange={setIsMinor}
          disabled={pending}
        />
        <SocialToggleRow
          label={s.boardNicknameToggle}
          hint={s.boardNicknameHint}
          value={nicknameOn}
          onValueChange={setUseNickname}
          disabled={pending || nicknameRequired}
        />
        {nicknameOn ? (
          <View className="gap-2 pt-1">
            <Text variant="label-lg" nativeID="board-nickname-label">
              {s.boardNicknameLabel}
            </Text>
            <Input
              value={nickname}
              onChangeText={setNickname}
              placeholder={s.boardNicknamePlaceholder}
              maxLength={BOARD_NICKNAME_MAX}
              autoCorrect={false}
              invalid={nickname.length > 0 && !nicknameValid}
              accessibilityLabel={s.boardNicknameLabel}
              accessibilityLabelledBy="board-nickname-label"
            />
          </View>
        ) : null}
      </View>

      <SocialErrorText message={error} />
      <Button
        label={s.boardJoin}
        disabled={pending || !nicknameValid}
        accessibilityState={{ disabled: pending || !nicknameValid, busy: pending }}
        onPress={() => onJoin({ nickname: chosenNickname, isMinor })}
      />
    </Card>
  );
}
