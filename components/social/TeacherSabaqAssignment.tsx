import { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/Button";
import { Field, Label } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Text } from "@/components/ui/Text";
import { parseAssignmentInput, type SabaqAssignment } from "@/lib/halaqa/sabaq-assignment";
import type { AssignedSabaq } from "@/lib/hifz/sabaq";
import { formatNumber } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import { formatSocialDate } from "@/lib/social/text";
import { SocialErrorText, socialRowStyle } from "./SocialControls";

type Language = "en" | "ar";

/**
 * SOC-03: the next sabaq a teacher sets for a member who shares their plan: the current one, if any,
 * and a page with a range of its lines. The member memorizes those lines next at their own daily pace,
 * then their plan goes on. Offline or while saving, nothing can be sent.
 */
export function TeacherSabaqAssignment({
  memberName,
  current,
  pending,
  error,
  saved,
  disabled,
  language,
  isRTL,
  s,
  onSave,
  onClear,
}: {
  memberName: string;
  current: SabaqAssignment | null;
  pending: boolean;
  /** The server's refusal or a failed send, from the screen. */
  error: string | null;
  /** The last save or clear that succeeded, from the screen. */
  saved: string | null;
  /** Offline: the form shows but cannot send. */
  disabled: boolean;
  language: Language;
  isRTL: boolean;
  s: UIStrings;
  onSave: (range: AssignedSabaq) => void;
  onClear: () => void;
}) {
  const number = (value: number) => formatNumber(value, language);
  const [page, setPage] = useState(current ? number(current.page) : "");
  const [fromLine, setFromLine] = useState(number(current?.fromLine ?? 1));
  const [toLine, setToLine] = useState(number(current?.toLine ?? 15));
  const [invalid, setInvalid] = useState(false);
  const dir = isRTL ? "rtl" : "ltr";

  const save = () => {
    const range = parseAssignmentInput(page, fromLine, toLine);
    setInvalid(range === null);
    if (range) onSave(range);
  };

  const fields: ReadonlyArray<readonly [string, string, (value: string) => void, number]> = [
    [s.teacherAssignPage, page, setPage, 3],
    [s.teacherAssignFrom, fromLine, setFromLine, 2],
    [s.teacherAssignTo, toLine, setToLine, 2],
  ];

  return (
    <View className="mt-3 gap-2 border-t border-warm-200 pt-3 dark:border-neutral-800">
      <Text variant="title-sm" accessibilityRole="header">
        {s.teacherAssignTitle}
      </Text>
      {current ? (
        <>
          <Text variant="body-sm">
            {interpolate(s.teacherAssignCurrent, {
              page: number(current.page),
              from: number(current.fromLine),
              to: number(current.toLine),
            })}
          </Text>
          <Text variant="caption">
            {interpolate(s.teacherAssignBy, {
              name: current.teacherName ?? "",
              date: formatSocialDate(current.assignedAt, language),
            })}
          </Text>
        </>
      ) : (
        <Text variant="body-sm">{s.teacherAssignNone}</Text>
      )}
      <Text variant="caption">{interpolate(s.teacherAssignHint, { name: memberName })}</Text>
      <View className="gap-2" style={socialRowStyle(isRTL)}>
        {fields.map(([label, value, setValue, maxLength]) => (
          <Field key={label} dir={dir} className="min-w-0 flex-1">
            <Label dir={dir}>{label}</Label>
            <Input
              dir={dir}
              className="w-full"
              value={value}
              onChangeText={(text) => {
                setValue(text);
                setInvalid(false);
              }}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={maxLength}
              accessibilityLabel={label}
              invalid={invalid}
              editable={!pending}
            />
          </Field>
        ))}
      </View>
      {invalid ? <SocialErrorText message={s.teacherAssignInvalid} /> : null}
      <SocialErrorText message={error} />
      {saved && !error && !invalid ? (
        <Text variant="body-sm" accessibilityLiveRegion="polite">
          {saved}
        </Text>
      ) : null}
      <View className="flex-wrap gap-2" style={socialRowStyle(isRTL)}>
        <Button label={s.teacherAssignSave} onPress={save} disabled={pending || disabled} />
        {current ? (
          <Button
            variant="outline"
            className="border border-warm-300 dark:border-neutral-700"
            label={s.teacherAssignClear}
            onPress={onClear}
            disabled={pending || disabled}
          />
        ) : null}
      </View>
    </View>
  );
}
