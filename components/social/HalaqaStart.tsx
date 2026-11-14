import { useState } from "react";
import { View } from "react-native";
import { ChevronLeft, ChevronRight, KeyRound, Plus, Users, type LucideIcon } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { DisclosureRow } from "@/components/ui/MirroredRow";
import { OverlayBody, OverlayFooter, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { Text } from "@/components/ui/Text";
import { HALAQA_NAME_MAX, INVITE_CODE_PATTERN, normalizeInviteCode } from "@/lib/halaqa/api";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { SocialErrorText, SocialToggleRow, socialRowStyle, useSocialAccent } from "./SocialControls";

type FormMode = "create" | "join" | null;

/** One plain row of the compact card: icon, label and a chevron, a full-width 48 pt target. */
function CompactAction({ icon: Icon, label, disabled, onPress }: { icon: LucideIcon; label: string; disabled: boolean; onPress: () => void }) {
  const { isRTL } = useSettings();
  const { accent, muted } = useSocialAccent();
  const DisclosureChevron = isRTL ? ChevronLeft : ChevronRight;
  return (
    <DisclosureRow
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className="min-h-12"
      style={{ opacity: disabled ? 0.5 : 1 }}
      leading={<Icon size={18} color={accent} />}
      trailing={<DisclosureChevron size={18} color={muted} />}
    >
      <Text variant="title-sm">{label}</Text>
    </DisclosureRow>
  );
}

/**
 * Ways into a halaqa (SOC-02, SOC-04): create an invite halaqa, join one by code, or join a matched
 * halaqa. `compact` is the "join or create another" card under an existing group.
 */
export function HalaqaStart({
  compact = false,
  matchedAllowed = true,
  pending,
  error,
  onCreate,
  onJoinCode,
  onJoinMatched,
  onClearError,
}: {
  compact?: boolean;
  /** False for an account under 18: matched halaqas are for adults (ETH-07), so the join is not offered. */
  matchedAllowed?: boolean;
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
      <Card elevation="low" className={compact ? "gap-1 px-5 py-4" : "items-stretch gap-4 p-6"}>
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
        {compact ? (
          // Under a joined halaqa these are secondary: plain stacked rows, no filled button.
          <View>
            {matchedAllowed ? <CompactAction icon={Users} label={s.halaqaJoinMatched} disabled={pending} onPress={onJoinMatched} /> : null}
            <CompactAction icon={KeyRound} label={s.halaqaJoinCode} disabled={pending} onPress={() => open("join")} />
            <CompactAction icon={Plus} label={s.halaqaCreate} disabled={pending} onPress={() => open("create")} />
            {mode === null ? <SocialErrorText message={error} /> : null}
          </View>
        ) : (
          <View className="gap-3">
            {matchedAllowed ? (
              <>
                <Button label={s.halaqaJoinMatched} onPress={onJoinMatched} disabled={pending} />
                <Text variant="caption" align="center">
                  {s.halaqaMatchedNote}
                </Text>
              </>
            ) : null}
            <Button variant="outline" className="border border-warm-300 dark:border-neutral-700" onPress={() => open("join")} disabled={pending}>
              <View className="items-center gap-2" style={socialRowStyle(isRTL)}>
                <KeyRound size={16} color={accent} />
                <Text variant="title-sm">{s.halaqaJoinCode}</Text>
              </View>
            </Button>
            <Button variant="outline" className="border border-warm-300 dark:border-neutral-700" onPress={() => open("create")} disabled={pending}>
              <View className="items-center gap-2" style={socialRowStyle(isRTL)}>
                <Plus size={16} color={accent} />
                <Text variant="title-sm">{s.halaqaCreate}</Text>
              </View>
            </Button>
            {mode === null ? <SocialErrorText message={error} /> : null}
          </View>
        )}
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
