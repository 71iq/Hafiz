import React, { useState, useEffect, useCallback } from "react";
import { View, Text, Pressable, ScrollView, TextInput, ActivityIndicator, useWindowDimensions } from "react-native";
import { Check } from "lucide-react-native";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { createDeck, generateDeckId } from "@/lib/fsrs/queries";
import type { DeckScope, SurahAyahRange } from "@/lib/fsrs/types";
import { OverlayBody, OverlayFooter, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";

type ScopeType = "surah" | "juz" | "hizb" | "custom";

interface Props {
  visible: boolean;
  onClose: () => void;
  onCreated: (count: number) => void;
}

type SurahRow = { number: number; name_arabic: string; name_english: string; ayah_count: number };
type RangeInputValue = { from: string; to: string };

export function CreateDeckSheet({ visible, onClose, onCreated }: Props) {
  const db = useDatabase();
  const { isDark, isRTL } = useSettings();
  const { width } = useWindowDimensions();
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const s = useStrings();
  const [scopeType, setScopeType] = useState<ScopeType>("surah");
  const [selectedSurahs, setSelectedSurahs] = useState<Set<number>>(new Set());
  const [selectedSurahRanges, setSelectedSurahRanges] = useState<Record<number, RangeInputValue>>({});
  const [selectedJuz, setSelectedJuz] = useState<Set<number>>(new Set());
  const [selectedHizb, setSelectedHizb] = useState<Set<number>>(new Set());
  const [customFrom, setCustomFrom] = useState({ surah: "1", ayah: "1" });
  const [customTo, setCustomTo] = useState({ surah: "1", ayah: "7" });
  const [surahs, setSurahs] = useState<SurahRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    db.getAllAsync<SurahRow>(
      "SELECT number, name_arabic, name_english, ayah_count FROM surahs ORDER BY number"
    ).then(setSurahs);
  }, [visible, db]);

  const toggleSurah = useCallback((n: number) => {
    setError(null);
    setSelectedSurahs((prev) => {
      const next = new Set(prev);
      const willSelect = !next.has(n);
      if (willSelect) next.add(n); else next.delete(n);
      setSelectedSurahRanges((prevRanges) => {
        const nextRanges = { ...prevRanges };
        if (willSelect) {
          const ayahCount = surahs.find((row) => row.number === n)?.ayah_count ?? 1;
          nextRanges[n] = nextRanges[n] ?? { from: "1", to: String(ayahCount) };
        } else {
          delete nextRanges[n];
        }
        return nextRanges;
      });
      return next;
    });
  }, [surahs]);

  const updateSurahRange = useCallback((surah: number, field: keyof RangeInputValue, value: string) => {
    setError(null);
    setSelectedSurahRanges((prev) => {
      const ayahCount = surahs.find((row) => row.number === surah)?.ayah_count ?? 1;
      const current = prev[surah] ?? { from: "1", to: String(ayahCount) };
      return { ...prev, [surah]: { ...current, [field]: value } };
    });
  }, [surahs]);

  const toggleJuz = useCallback((n: number) => {
    setError(null);
    setSelectedJuz((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });
  }, []);

  const toggleHizb = useCallback((n: number) => {
    setError(null);
    setSelectedHizb((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });
  }, []);

  const getCustomScope = (): DeckScope | null => {
    const surahStart = parseInt(customFrom.surah, 10);
    const ayahStart = parseInt(customFrom.ayah, 10);
    const surahEnd = parseInt(customTo.surah, 10);
    const ayahEnd = parseInt(customTo.ayah, 10);
    if (![surahStart, ayahStart, surahEnd, ayahEnd].every(Number.isFinite)) return null;
    const startSurah = surahs.find((row) => row.number === surahStart);
    const endSurah = surahs.find((row) => row.number === surahEnd);
    if (!startSurah || !endSurah) return null;
    if (ayahStart < 1 || ayahStart > startSurah.ayah_count) return null;
    if (ayahEnd < 1 || ayahEnd > endSurah.ayah_count) return null;
    if (surahEnd < surahStart) return null;
    if (surahEnd === surahStart && ayahEnd < ayahStart) return null;
    return { type: "custom", surahStart, ayahStart, surahEnd, ayahEnd };
  };

  const getSurahScope = (): DeckScope | null => {
    if (selectedSurahs.size === 0) return null;
    const selected = [...selectedSurahs].sort((a, b) => a - b);
    const ranges: SurahAyahRange[] = [];
    let hasPartialRange = false;
    for (const surahNumber of selected) {
      const surah = surahs.find((row) => row.number === surahNumber);
      if (!surah) return null;
      const range = selectedSurahRanges[surahNumber] ?? { from: "1", to: String(surah.ayah_count) };
      const ayahStart = Number(range.from);
      const ayahEnd = Number(range.to);
      if (![ayahStart, ayahEnd].every(Number.isInteger)) return null;
      if (ayahStart < 1 || ayahEnd > surah.ayah_count || ayahEnd < ayahStart) return null;
      if (ayahStart !== 1 || ayahEnd !== surah.ayah_count) hasPartialRange = true;
      ranges.push({ surah: surahNumber, ayahStart, ayahEnd });
    }
    return { type: "surah", surahs: selected, ...(hasPartialRange ? { ranges } : {}) };
  };

  const canCreate = () => {
    switch (scopeType) {
      case "surah": return getSurahScope() !== null;
      case "juz": return selectedJuz.size > 0;
      case "hizb": return selectedHizb.size > 0;
      case "custom": return getCustomScope() !== null;
    }
  };

  const handleCreate = async () => {
    if (creating) return;
    setError(null);
    if (!canCreate()) {
      setError(scopeType === "custom" || (scopeType === "surah" && selectedSurahs.size > 0) ? s.deckRangeInvalid : s.deckSelectionRequired);
      return;
    }
    setCreating(true);
    try {
      let scope: DeckScope;
      switch (scopeType) {
        case "surah":
          scope = getSurahScope()!;
          break;
        case "juz":
          scope = { type: "juz", juzNumbers: [...selectedJuz] };
          break;
        case "hizb":
          scope = { type: "hizb", hizbNumbers: [...selectedHizb] };
          break;
        case "custom":
          scope = getCustomScope()!;
          break;
      }
      const deckId = generateDeckId(scope);
      const count = await createDeck(db, deckId, scope);
      onCreated(count);
      // Reset state
      setSelectedSurahs(new Set());
      setSelectedSurahRanges({});
      setSelectedJuz(new Set());
      setSelectedHizb(new Set());
      onClose();
    } catch (e) {
      console.warn("[CreateDeckSheet] Failed to create deck:", e);
      setError(s.deckCreateFailed);
    } finally {
      setCreating(false);
    }
  };

  const SCOPE_TABS: { value: ScopeType; label: string }[] = [
    { value: "surah", label: s.flashcardsScopeBysurah },
    { value: "juz", label: s.flashcardsScopeByjuz },
    { value: "hizb", label: s.flashcardsScopeByhizb },
    { value: "custom", label: s.flashcardsScopeCustom },
  ];

  return (
    <ResponsiveSheet
      open={visible}
      onClose={onClose}
      maxWidth={760}
      maxHeight={720}
    >
      <OverlayHeader
        title={s.flashcardsCreateDeckTitle}
        onClose={onClose}
        isRTL={isRTL}
        showHandle={isPhone}
      />

      <View className="mb-4 mt-2">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            gap: 8,
            alignItems: "center",
            paddingHorizontal: 20,
            paddingVertical: 2,
            flexDirection: isRTL ? "row-reverse" : "row",
          }}
          style={{ maxHeight: 52 }}
        >
          {SCOPE_TABS.map((tab) => (
            <Pressable
              key={tab.value}
              onPress={() => {
                setError(null);
                setScopeType(tab.value);
              }}
              className={`h-11 rounded-full px-5 items-center justify-center ${
                scopeType === tab.value ? "bg-primary-accent" : "bg-surface-low dark:bg-surface-dark-low"
              }`}
              style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
            >
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: scopeType === tab.value ? "Manrope_600SemiBold" : "Manrope_500Medium",
                  fontSize: 13,
                  color: scopeType === tab.value ? "#fff" : (isDark ? "#a3a3a3" : "#6e5a47"),
                }}
              >
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <OverlayBody contentContainerClassName="px-5 pb-8">
        {scopeType === "surah" && (
          <View className="gap-2">
            {surahs.map((surah) => (
              <SurahItem
                key={surah.number}
                surah={surah}
                selected={selectedSurahs.has(surah.number)}
                onToggle={() => toggleSurah(surah.number)}
                isDark={isDark}
                isRTL={isRTL}
                ayahCountLabel={interpolate("{{n}} {{label}}", { n: surah.ayah_count, label: s.ayahs })}
                range={selectedSurahRanges[surah.number] ?? { from: "1", to: String(surah.ayah_count) }}
                rangeLabels={{
                  from: `${s.flashcardsFrom} ${s.reflectionAyahLabel}`,
                  to: `${s.flashcardsTo} ${s.reflectionAyahLabel}`,
                }}
                onRangeChange={(field, value) => updateSurahRange(surah.number, field, value)}
              />
            ))}
          </View>
        )}

        {scopeType === "juz" && (
          <View className="flex-row flex-wrap gap-3">
            {Array.from({ length: 30 }, (_, i) => i + 1).map((n) => (
              <NumberChip key={n} number={n} selected={selectedJuz.has(n)} onToggle={() => toggleJuz(n)} isDark={isDark} />
            ))}
          </View>
        )}

        {scopeType === "hizb" && (
          <View className="flex-row flex-wrap gap-3">
            {Array.from({ length: 60 }, (_, i) => i + 1).map((n) => (
              <NumberChip key={n} number={n} selected={selectedHizb.has(n)} onToggle={() => toggleHizb(n)} isDark={isDark} />
            ))}
          </View>
        )}

        {scopeType === "custom" && (
          <Card elevation="low" className="p-5">
            <Text className="text-charcoal dark:text-neutral-300 mb-3" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>{s.flashcardsFrom}</Text>
            <View className="flex-row gap-3 mb-5">
              <RangeInput label={s.tabSurah} value={customFrom.surah} onChangeText={(v) => { setError(null); setCustomFrom((p) => ({ ...p, surah: v })); }} isDark={isDark} isRTL={isRTL} />
              <RangeInput label={s.reflectionAyahLabel} value={customFrom.ayah} onChangeText={(v) => { setError(null); setCustomFrom((p) => ({ ...p, ayah: v })); }} isDark={isDark} isRTL={isRTL} />
            </View>
            <Text className="text-charcoal dark:text-neutral-300 mb-3" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>{s.flashcardsTo}</Text>
            <View className="flex-row gap-3">
              <RangeInput label={s.tabSurah} value={customTo.surah} onChangeText={(v) => { setError(null); setCustomTo((p) => ({ ...p, surah: v })); }} isDark={isDark} isRTL={isRTL} />
              <RangeInput label={s.reflectionAyahLabel} value={customTo.ayah} onChangeText={(v) => { setError(null); setCustomTo((p) => ({ ...p, ayah: v })); }} isDark={isDark} isRTL={isRTL} />
            </View>
          </Card>
        )}
      </OverlayBody>

      <OverlayFooter isRTL={isRTL}>
        <View className="w-full gap-3">
          {error && (
            <Text
              className="text-red-600 dark:text-red-400"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 13, textAlign: isRTL ? "right" : "left" }}
            >
              {error}
            </Text>
          )}
          <Button onPress={handleCreate} disabled={!canCreate() || creating} className="w-full">
            {creating ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, color: "#fff" }}>{s.flashcardsCreate}</Text>}
          </Button>
        </View>
      </OverlayFooter>
    </ResponsiveSheet>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function SurahItem({
  surah,
  selected,
  onToggle,
  isDark,
  isRTL,
  ayahCountLabel,
  range,
  rangeLabels,
  onRangeChange,
}: {
  surah: SurahRow;
  selected: boolean;
  onToggle: () => void;
  isDark: boolean;
  isRTL: boolean;
  ayahCountLabel: string;
  range: RangeInputValue;
  rangeLabels: { from: string; to: string };
  onRangeChange: (field: keyof RangeInputValue, value: string) => void;
}) {
  return (
    <View
      className={`p-4 rounded-2xl ${
        selected
          ? "bg-primary-accent/10 dark:bg-primary-bright/15"
          : "bg-surface-low dark:bg-surface-dark-low"
      }`}
    >
      <Pressable
        onPress={onToggle}
        className={`items-center gap-3 ${isRTL ? "flex-row-reverse" : "flex-row"}`}
        style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
      >
        <View
          className={`w-8 h-8 rounded-full items-center justify-center ${
            selected ? "bg-primary-accent" : "bg-surface-high dark:bg-surface-dark-high"
          }`}
        >
          {selected ? (
            <Check size={14} color="#fff" />
          ) : (
            <Text
              style={{
                fontFamily: "Manrope_600SemiBold",
                fontSize: 11,
                color: isDark ? "#737373" : "#b9a085",
              }}
            >
              {surah.number}
            </Text>
          )}
        </View>
        <View className="flex-1">
          <Text
            className="text-charcoal dark:text-neutral-200"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 14, textAlign: isRTL ? "right" : "left" }}
          >
            {surah.name_english}
          </Text>
          <Text
            className="text-warm-400 dark:text-neutral-500"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
          >
            {ayahCountLabel}
          </Text>
        </View>
        <Text
          className="text-charcoal dark:text-neutral-300"
          style={{
            fontFamily: "Manrope_400Regular",
            fontSize: 16,
            writingDirection: "rtl",
            textAlign: isRTL ? "left" : "right",
          }}
        >
          {surah.name_arabic}
        </Text>
      </Pressable>
      {selected && (
        <View
          className="mt-3 gap-3"
          style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
        >
          <RangeInput
            label={rangeLabels.from}
            value={range.from}
            onChangeText={(value) => onRangeChange("from", value)}
            isDark={isDark}
            isRTL={isRTL}
          />
          <RangeInput
            label={rangeLabels.to}
            value={range.to}
            onChangeText={(value) => onRangeChange("to", value)}
            isDark={isDark}
            isRTL={isRTL}
          />
        </View>
      )}
    </View>
  );
}

function NumberChip({
  number,
  selected,
  onToggle,
  isDark,
}: {
  number: number;
  selected: boolean;
  onToggle: () => void;
  isDark: boolean;
}) {
  return (
    <Pressable
      onPress={onToggle}
      className={`w-14 h-14 rounded-2xl items-center justify-center ${
        selected
          ? "bg-primary-accent"
          : "bg-surface-low dark:bg-surface-dark-low"
      }`}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.95 : 1 }] })}
    >
      <Text
        style={{
          fontFamily: selected ? "Manrope_700Bold" : "Manrope_500Medium",
          fontSize: 16,
          color: selected ? "#fff" : (isDark ? "#a3a3a3" : "#6e5a47"),
        }}
      >
        {number}
      </Text>
    </Pressable>
  );
}

function RangeInput({
  label,
  value,
  onChangeText,
  isDark,
  isRTL,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  isDark: boolean;
  isRTL: boolean;
}) {
  return (
    <View className="flex-1">
      <Text
        className="text-warm-400 dark:text-neutral-500 mb-1"
        style={{ fontFamily: "Manrope_400Regular", fontSize: 11, textAlign: isRTL ? "right" : "left" }}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="number-pad"
        className="bg-surface-high dark:bg-surface-dark-high rounded-xl px-4 py-3 text-charcoal dark:text-neutral-200"
        style={{ fontFamily: "Manrope_500Medium", fontSize: 15, textAlign: isRTL ? "right" : "left" }}
        placeholderTextColor={isDark ? "#525252" : "#DFD9D1"}
      />
    </View>
  );
}
