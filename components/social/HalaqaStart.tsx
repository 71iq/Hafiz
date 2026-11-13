import { useState } from "react";
import { View } from "react-native";
import { KeyRound, Plus, Users } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { OverlayBody, OverlayFooter, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { Text } from "@/components/ui/Text";
import { HALAQA_NAME_MAX, INVITE_CODE_PATTERN, normalizeInviteCode } from "@/lib/halaqa/api";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { SocialErrorText, SocialToggleRow, socialRowStyle, useSocialAccent } from "./SocialControls";

type FormMode = "create" | "join" | null;

/**
 * Ways into a halaqa (SOC-02, SOC-04): create an invite halaqa, join one by code, or join a matched
 * halaqa. `compact` is the "join or create another" card under an existing group.
 */
export function HalaqaStart({
  compact = false,
  pending,
  error,
  onCreate,
  onJoinCode,
  onJoinMatched,
  onClearError,
}: {
  compact?: boolean;
  pending: boolean;
  error: string | null;
  onCreate: (name: string, asTeacher: boolean) => Promise<boolean>;
  onJoinCode: (code: string) => Promise<boolean>;
  onJoinMatched: () => void;
  onClearError: () => void;
}) {
  const s = useStrings();
  const { isRTL } = useSettings();
  const { accent } = useSocialAccent();
  const [mode, setMode] = useState<FormMode>(null);
  const [name, setName] = useState("");
  const [asTeacher, setAsTeacher] = useState(false);
  const [code, setCode] = useState("");

  const open = (next: FormMode) => {
    onClearError();
    setMode(next);
  };
  const close = () => {
    if (pending) return;
    setMode(null);
    onClearError();
  };
  const trimmedName = name.trim();
  const normalizedCode = normalizeInviteCode(code);
  const canSubmit =
    mode === "create"
      ? trimmedName.length > 0 && trimmedName.length <= HALAQA_NAME_MAX
      : INVITE_CODE_PATTERN.test(normalizedCode);

  const submit = async () => {
    if (!canSubmit || pending) return;
    const done = mode === "create" ? await onCreate(trimmedName, asTeacher) : await onJoinCode(normalizedCode);
    if (done) {
      setMode(null);
      setName("");
      setCode("");
      setAsTeacher(false);
    }
  };

  return (
    <>
      <Card elevation="low" className={compact ? "gap-3 p-5" : "items-stretch gap-4 p-6"}>
        {compact ? (
          <Text variant="title-sm">{s.halaqaAddAnother}</Text>
        ) : (
          <View className="items-center gap-3">
            <View className="h-16 w-16 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/15">
              <Users size={28} color={accent} />
            </View>
            <Text variant="headline" align="center">
              {s.halaqaEmptyTitle}
            </Text>
            <Text variant="body-sm" align="center" className="text-warm-700 dark:text-neutral-300">
              {s.halaqaEmptyBody}
            </Text>
          </View>
        )}
        <View className="gap-3">
          <Button label={s.halaqaJoinMatched} onPress={onJoinMatched} disabled={pending} />
          {!compact ? <Text variant="caption" align="center">{s.halaqaMatchedNote}</Text> : null}
          <View className="gap-3" style={compact ? socialRowStyle(isRTL) : undefined}>
            <Button variant="outline" className="flex-1 border border-warm-300 dark:border-neutral-700" onPress={() => open("join")} disabled={pending}>
              <View className="items-center gap-2" style={socialRowStyle(isRTL)}>
                <KeyRound size={16} color={accent} />
                <Text variant="title-sm">{s.halaqaJoinCode}</Text>
              </View>
            </Button>
            <Button variant="outline" className="flex-1 border border-warm-300 dark:border-neutral-700" onPress={() => open("create")} disabled={pending}>
              <View className="items-center gap-2" style={socialRowStyle(isRTL)}>
                <Plus size={16} color={accent} />
                <Text variant="title-sm">{s.halaqaCreate}</Text>
              </View>
            </Button>
          </View>
          {mode === null ? <SocialErrorText message={error} /> : null}
        </View>
      </Card>

      <ResponsiveSheet open={mode !== null} onClose={close} dismissOnBackdrop={!pending} maxWidth={520} avoidKeyboard>
        <OverlayHeader
          title={mode === "create" ? s.halaqaCreateTitle : s.halaqaJoinTitle}
          onClose={close}
          showHandle
          isRTL={isRTL}
        />
        <OverlayBody contentContainerClassName="gap-4 px-5 pb-4 pt-2">
          {mode === "create" ? (
            <>
              <View className="gap-2">
                <Text variant="label-lg" nativeID="halaqa-name-label">
                  {s.halaqaNameLabel}
                </Text>
                <Input
                  value={name}
                  onChangeText={setName}
                  placeholder={s.halaqaNamePlaceholder}
                  maxLength={HALAQA_NAME_MAX}
                  accessibilityLabelledBy="halaqa-name-label"
                  accessibilityLabel={s.halaqaNameLabel}
                  returnKeyType="done"
                  onSubmitEditing={() => void submit()}
                />
              </View>
              <SocialToggleRow
                label={s.halaqaAsTeacher}
                hint={s.halaqaAsTeacherHint}
                value={asTeacher}
                onValueChange={setAsTeacher}
                disabled={pending}
              />
            </>
          ) : (
            <View className="gap-2">
              <Text variant="label-lg" nativeID="halaqa-code-label">
                {s.halaqaCodeLabel}
              </Text>
              <Input
                value={code}
                onChangeText={(value) => setCode(value.toUpperCase())}
                placeholder={s.halaqaCodePlaceholder}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={12}
                accessibilityLabelledBy="halaqa-code-label"
                accessibilityLabel={s.halaqaCodeLabel}
                dir="ltr"
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
              />
            </View>
          )}
          <SocialErrorText message={error} />
        </OverlayBody>
        <OverlayFooter isRTL={isRTL} className="gap-3 px-5 pb-5">
          <View className="gap-3" style={socialRowStyle(isRTL)}>
            <Button variant="ghost" className="flex-1" label={s.socialCancel} onPress={close} disabled={pending} />
            <Button
              className="flex-1"
              label={mode === "create" ? s.halaqaCreateAction : s.halaqaJoinAction}
              onPress={() => void submit()}
              disabled={!canSubmit || pending}
              accessibilityState={{ disabled: !canSubmit || pending, busy: pending }}
            />
          </View>
        </OverlayFooter>
      </ResponsiveSheet>
    </>
  );
}
