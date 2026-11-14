import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/Button";
import { Field, Label } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Text } from "@/components/ui/Text";
import { formatAyahRef } from "@/lib/arabic";
import { useDatabase } from "@/lib/database/provider";
import type { DatabaseExecutor } from "@/lib/database/types";
import { parseAssignmentInput, type SabaqAssignment } from "@/lib/halaqa/sabaq-assignment";
import { loadSabaqRangePreview, type PreviewAyah, type SabaqRangePreview } from "@/lib/halaqa/sabaq-preview";
import type { AssignedSabaq } from "@/lib/hifz/sabaq";
import { formatNumber } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import { formatSocialDate } from "@/lib/social/text";
import { SocialErrorText, socialRowStyle } from "./SocialControls";

type Language = "en" | "ar";

const rangeKey = (range: AssignedSabaq) => `${range.page}:${range.fromLine}-${range.toLine}`;

/**
 * What the typed range holds, read from the local database when the range changes. `read` gives Save
 * the same answer, waiting for a read still running. Null while reading and after a failed read: the
 * form then shows no preview and saves as it did before there was one.
 */
function useRangePreview(db: DatabaseExecutor, range: AssignedSabaq | null) {
  const reads = useRef(new Map<string, Promise<SabaqRangePreview | null>>());
  const read = useCallback(
    (wanted: AssignedSabaq) => {
      const key = rangeKey(wanted);
      const running = reads.current.get(key);
      if (running) return running;
      const next = loadSabaqRangePreview(db, wanted).catch((error: unknown) => {
        reads.current.delete(key);
        console.warn("[TeacherSabaqAssignment] Preview failed to load:", error);
        return null;
      });
      reads.current.set(key, next);
      return next;
    },
    [db],
  );
  const [shown, setShown] = useState<{ key: string; preview: SabaqRangePreview | null } | null>(null);
  useEffect(() => {
    if (!range) return;
    let current = true;
    const key = rangeKey(range);
    void read(range).then((preview) => {
      if (current) setShown((last) => (last?.key === key && last.preview === preview ? last : { key, preview }));
    });
    return () => {
      current = false;
    };
  }, [range, read]);
  return { preview: range && shown?.key === rangeKey(range) ? shown.preview : null, read };
}

/** "Al-Mulk 67:1 to 67:4", or "سورة الملك، من ٦٧:١ إلى ٦٧:٤" in Arabic. */
function coversLabel(first: PreviewAyah, last: PreviewAyah, language: Language, s: UIStrings): string {
  const name = (ayah: PreviewAyah) => (language === "ar" ? ayah.surahNameArabic : ayah.surahNameEnglish);
  const ref = (ayah: PreviewAyah) => formatAyahRef(language === "ar", ayah.surah, ayah.ayah);
  if (first.surah !== last.surah) {
    return interpolate(s.teacherAssignCoversSurahs, {
      fromSurah: name(first),
      from: ref(first),
      toSurah: name(last),
      to: ref(last),
    });
  }
  if (first.ayah === last.ayah) return interpolate(s.teacherAssignCoversAyah, { surah: name(first), ayah: ref(first) });
  return interpolate(s.teacherAssignCoversRange, { surah: name(first), from: ref(first), to: ref(last) });
}

/**
 * SOC-03: the next sabaq a teacher sets for a member who shares their plan: the current one, if any,
 * and a page with a range of its lines. The member memorizes those lines next at their own daily pace,
 * then their plan goes on. Offline or while saving, nothing can be sent.
 *
 * As the numbers change, a preview shows the ayat the lines cover and how the first line opens, and
 * says when the range starts or ends inside an ayah, where the lesson stops too. A range with no ayah
 * lines is refused before anything is sent.
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
  const [noAyat, setNoAyat] = useState(false);
  const dir = isRTL ? "rtl" : "ltr";
  const range = useMemo(() => parseAssignmentInput(page, fromLine, toLine), [page, fromLine, toLine]);
  const { preview, read } = useRangePreview(useDatabase(), range);

  const save = async () => {
    setInvalid(range === null);
    setNoAyat(false);
    if (!range) return;
    // The preview's answer for this range, waited for if it is still being read.
    if ((await read(range))?.kind === "empty") {
      setNoAyat(true);
      return;
    }
    onSave(range);
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
              name: current.teacherName || s.teacherAssignSomeTeacher,
              date: formatSocialDate(current.assignedAt, language),
            })}
          </Text>
        </>
      ) : (
        <Text variant="body-sm">{s.teacherAssignNone}</Text>
      )}
      <Text variant="caption">{`${interpolate(s.teacherAssignHint, { name: memberName })} ${s.teacherAssignMushaf}`}</Text>
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
                setNoAyat(false);
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
      {noAyat ? (
        <SocialErrorText message={s.teacherAssignNoAyat} />
      ) : preview?.kind === "empty" ? (
        <Text variant="body-sm">{s.teacherAssignNoAyat}</Text>
      ) : null}
      {preview?.kind === "ayat" ? (
        <View className="gap-1">
          <Text variant="body-sm">{coversLabel(preview.first, preview.last, language, s)}</Text>
          {preview.opening ? (
            // Uthmani text reads right to left in either interface language.
            <Text variant="body" dir="rtl" style={{ lineHeight: 30 }}>
              {preview.openingContinues ? `${preview.opening} …` : preview.opening}
            </Text>
          ) : null}
          {preview.startsMidAyah ? (
            <Text variant="caption">{interpolate(s.teacherAssignMidStart, { line: number(preview.firstLine) })}</Text>
          ) : null}
          {preview.endsMidAyah ? (
            <Text variant="caption">{interpolate(s.teacherAssignMidEnd, { line: number(preview.lastLine) })}</Text>
          ) : null}
        </View>
      ) : null}
      <SocialErrorText message={error} />
      {saved && !error && !invalid && !noAyat ? (
        <Text variant="body-sm" accessibilityLiveRegion="polite">
          {saved}
        </Text>
      ) : null}
      <View className="flex-wrap gap-2" style={socialRowStyle(isRTL)}>
        <Button label={s.teacherAssignSave} onPress={() => void save()} disabled={pending || disabled} />
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
