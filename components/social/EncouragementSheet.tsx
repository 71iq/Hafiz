import { useState } from "react";
import { Pressable, View } from "react-native";
import { HandHeart } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { Text } from "@/components/ui/Text";
import { ENCOURAGEMENT_BODY_MAX, ENCOURAGEMENT_TEMPLATE_IDS, type EncouragementTemplateId } from "@/lib/halaqa/api";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { ENCOURAGEMENT_STRING_KEYS } from "@/lib/social/encouragements";
import { SocialErrorText, socialRowStyle, useSocialAccent } from "./SocialControls";

/** SOC-06: one tap sends a fixed encouragement; invite halaqas may also send a short note. */
export function EncouragementSheet({
  recipientName,
  allowFreeText,
  pending,
  error,
  onSend,
  onClose,
}: {
  recipientName: string | null;
  allowFreeText: boolean;
  pending: boolean;
  error: string | null;
  onSend: (choice: { templateId: EncouragementTemplateId | null; body: string | null }) => void;
  onClose: () => void;
}) {
  const s = useStrings();
  const { isRTL } = useSettings();
  const { accent } = useSocialAccent();
  const [body, setBody] = useState("");
  const open = recipientName !== null;
  const close = () => {
    if (pending) return;
    setBody("");
    onClose();
  };

  return (
    <ResponsiveSheet open={open} onClose={close} dismissOnBackdrop={!pending} maxWidth={560} maxHeight="86%" avoidKeyboard>
      <OverlayHeader
        title={interpolate(s.halaqaEncourageTitle, { name: recipientName ?? "" })}
        subtitle={s.halaqaEncourageNote}
        onClose={close}
        showHandle
        isRTL={isRTL}
      />
      <OverlayBody contentContainerClassName="gap-2 px-5 pb-6 pt-2">
        {ENCOURAGEMENT_TEMPLATE_IDS.map((templateId) => {
          const text = s[ENCOURAGEMENT_STRING_KEYS[templateId]];
          return (
            <Pressable
              key={templateId}
              accessibilityRole="button"
              accessibilityLabel={text}
              accessibilityState={{ disabled: pending }}
              disabled={pending}
              onPress={() => onSend({ templateId, body: null })}
              className="min-h-11 items-center gap-3 rounded-2xl bg-surface-low px-4 py-3 dark:bg-surface-dark-low"
              style={({ pressed }) => [socialRowStyle(isRTL), { opacity: pressed || pending ? 0.7 : 1 }]}
            >
              <HandHeart size={18} color={accent} />
              <Text variant="body-sm" className="min-w-0 flex-1">
                {text}
              </Text>
            </Pressable>
          );
        })}
        {allowFreeText ? (
          <View className="mt-3 gap-2">
            <Text variant="label-lg" nativeID="encouragement-note-label">
              {s.halaqaEncourageFreeText}
            </Text>
            <Input
              value={body}
              onChangeText={setBody}
              placeholder={s.halaqaEncourageFreePlaceholder}
              maxLength={ENCOURAGEMENT_BODY_MAX}
              multiline
              accessibilityLabel={s.halaqaEncourageFreeText}
              accessibilityLabelledBy="encouragement-note-label"
            />
            <Button
              label={s.halaqaEncourageSend}
              disabled={pending || body.trim().length === 0}
              onPress={() => onSend({ templateId: null, body: body.trim() })}
              accessibilityState={{ disabled: pending || body.trim().length === 0, busy: pending }}
            />
          </View>
        ) : null}
        <SocialErrorText message={error} />
      </OverlayBody>
    </ResponsiveSheet>
  );
}
