import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { X, Check } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { createDeck, generateDeckId, resolveScope } from "@/lib/fsrs/queries";
import type { DeckScope } from "@/lib/fsrs/types";

type ScopeType = "surah" | "juz" | "hizb" | "custom";

interface Props {
  visible: boolean;
  onClose: () => void;
  onCreated: (count: number) => void;
}

type SurahRow = { number: number; name_arabic: string; name_english: string; ayah_count: number };

export function CreateDeckSheet({ visible, onClose, onCreated }: Props) {
  const db = useDatabase();
  const { isDark } = useSettings();
  const s = useStrings();
  const [scopeType, setScopeType] = useState<ScopeType>("surah");
  const [selectedSurahs, setSelectedSurahs] = useState<Set<number>>(new Set());
  const [selectedJuz, setSelectedJuz] = useState<Set<number>>(new Set());
  const [selectedHizb, setSelectedHizb] = useState<Set<number>>(new Set());
  const [customFrom, setCustomFrom] = useState({ surah: "1", ayah: "1" });
  const [customTo, setCustomTo] = useState({ surah: "1", ayah: "7" });
  const [surahs, setSurahs] = useState<SurahRow[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!visible) return;
    db.getAllAsync<SurahRow>(
      "SELECT number, name_arabic, name_english, ayah_count FROM surahs ORDER BY number"
    ).then(setSurahs);
  }, [visible, db]);

  const toggleSurah = useCallback((n: number) => {
    setSelectedSurahs((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });
  }, []);

  const toggleJuz = useCallback((n: number) => {
    setSelectedJuz((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });
  }, []);

  const toggleHizb = useCallback((n: number) => {
    setSelectedHizb((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });
  }, []);

  const canCreate = () => {
    switch (scopeType) {
      case "surah": return selectedSurahs.size > 0;
      case "juz": return selectedJuz.size > 0;
      case "hizb": return selectedHizb.size > 0;
      case "custom": return true;
    }
  };

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      let scope: DeckScope;
      switch (scopeType) {
        case "surah":
          scope = { type: "surah", surahs: [...selectedSurahs] };
          break;
        case "juz":
          scope = { type: "juz", juzNumbers: [...selectedJuz] };
          break;
        case "hizb":
          scope = { type: "hizb", hizbNumbers: [...selectedHizb] };
          break;
        case "custom":
          scope = {
            type: "custom",
            surahStart: parseInt(customFrom.surah) || 1,
            ayahStart: parseInt(customFrom.ayah) || 1,
            surahEnd: parseInt(customTo.surah) || 1,
            ayahEnd: parseInt(customTo.ayah) || 7,
          };
          break;
      }
      const deckId = generateDeckId(scope);
      const count = await createDeck(db, deckId, scope);
      onCreated(count);
      // Reset state
      setSelectedSurahs(new Set());
      setSelectedJuz(new Set());
      setSelectedHizb(new Set());
      onClose();
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
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView
        className="flex-1 bg-surface dark:bg-surface-dark"
        edges={["top"]}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-6 py-4">
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "NotoSerif_700Bold", fontSize: 22 }}
          >
            {s.flashcardsCreateDeckTitle}
          </Text>
          <Pressable onPress={onClose} className="w-10 h-10 rounded-full bg-surface-high dark:bg-surface-dark-high items-center justify-center">
            <X size={18} color={isDark ? "#d4d4d4" : "#6e5a47"} />
          </Pressable>
        </View>

        {/* Scope type tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="px-6 mb-4"
          contentContainerStyle={{ gap: 8 }}
        >
          {SCOPE_TABS.map((tab) => (
            <Pressable
              key={tab.value}
              onPress={() => setScopeType(tab.value)}
              className={`px-5 py-2.5 rounded-full ${
                scopeType === tab.value
                  ? "bg-primary-accent"
                  : "bg-surface-low dark:bg-surface-dark-low"
              }`}
              style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
            >
              <Text
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

        {/* Content area */}
        <ScrollView className="flex-1 px-6" contentContainerStyle={{ paddingBottom: 120 }}>
          {scopeType === "surah" && (
            <View className="gap-2">
              {surahs.map((s) => (
                <SurahItem
                  key={s.number}
                  surah={s}
                  selected={selectedSurahs.has(s.number)}
                  onToggle={() => toggleSurah(s.number)}
                  isDark={isDark}
                />
              ))}
            </View>
          )}

          {scopeType === "juz" && (
            <View className="flex-row flex-wrap gap-3">
              {Array.from({ length: 30 }, (_, i) => i + 1).map((n) => (
                <NumberChip
                  key={n}
                  number={n}
                  selected={selectedJuz.has(n)}
                  onToggle={() => toggleJuz(n)}
                  isDark={isDark}
                />
              ))}
            </View>
          )}

          {scopeType === "hizb" && (
            <View className="flex-row flex-wrap gap-3">
              {Array.from({ length: 60 }, (_, i) => i + 1).map((n) => (
                <NumberChip
                  key={n}
                  number={n}
                  selected={selectedHizb.has(n)}
                  onToggle={() => toggleHizb(n)}
                  isDark={isDark}
                />
              ))}
            </View>
          )}

          {scopeType === "custom" && (
            <Card elevation="low" className="p-5">
              <Text
                className="text-charcoal dark:text-neutral-300 mb-3"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
              >
                {s.flashcardsFrom}
              </Text>
              <View className="flex-row gap-3 mb-5">
                <RangeInput
                  label="Surah"
                  value={customFrom.surah}
                  onChangeText={(v) => setCustomFrom((p) => ({ ...p, surah: v }))}
                  isDark={isDark}
                />
                <RangeInput
                  label="Ayah"
                  value={customFrom.ayah}
                  onChangeText={(v) => setCustomFrom((p) => ({ ...p, ayah: v }))}
                  isDark={isDark}
                />
              </View>
              <Text
                className="text-charcoal dark:text-neutral-300 mb-3"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
              >
                {s.flashcardsTo}
              </Text>
              <View className="flex-row gap-3">
                <RangeInput
                  label="Surah"
                  value={customTo.surah}
                  onChangeText={(v) => setCustomTo((p) => ({ ...p, surah: v }))}
                  isDark={isDark}
                />
                <RangeInput
                  label="Ayah"
                  value={customTo.ayah}
                  onChangeText={(v) => setCustomTo((p) => ({ ...p, ayah: v }))}
                  isDark={isDark}
                />
              </View>
            </Card>
          )}
        </ScrollView>

        {/* Bottom action */}
        <View
          className="px-6 pb-6 pt-4"
          style={{ backgroundColor: isDark ? "rgba(10,10,10,0.95)" : "rgba(255,248,241,0.95)" }}
        >
          <Button
            onPress={handleCreate}
            disabled={!canCreate() || creating}
            className="w-full"
          >
            {creating ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, color: "#fff" }}>
                {s.flashcardsCreate}
              </Text>
            )}
          </Button>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function SurahItem({
  surah,
  selected,
  onToggle,
  isDark,
}: {
  surah: SurahRow;
  selected: boolean;
  onToggle: () => void;
  isDark: boolean;
}) {
  return (
    <Pressable
      onPress={onToggle}
      className={`flex-row items-center p-4 rounded-2xl ${
        selected
          ? "bg-primary-accent/10 dark:bg-primary-bright/15"
          : "bg-surface-low dark:bg-surface-dark-low"
      }`}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
    >
      <View
        className={`w-8 h-8 rounded-full items-center justify-center mr-3 ${
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
          style={{ fontFamily: "Manrope_500Medium", fontSize: 14 }}
        >
          {surah.name_english}
        </Text>
        <Text
          className="text-warm-400 dark:text-neutral-500"
          style={{ fontFamily: "Manrope_400Regular", fontSize: 12 }}
        >
          {surah.ayah_count} ayahs
        </Text>
      </View>
      <Text
        className="text-charcoal dark:text-neutral-300"
        style={{ fontFamily: "Manrope_400Regular", fontSize: 16, writingDirection: "rtl" }}
      >
        {surah.name_arabic}
      </Text>
    </Pressable>
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
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  isDark: boolean;
}) {
  return (
    <View className="flex-1">
      <Text
        className="text-warm-400 dark:text-neutral-500 mb-1"
        style={{ fontFamily: "Manrope_400Regular", fontSize: 11 }}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="number-pad"
        className="bg-surface-high dark:bg-surface-dark-high rounded-xl px-4 py-3 text-charcoal dark:text-neutral-200"
        style={{ fontFamily: "Manrope_500Medium", fontSize: 15 }}
        placeholderTextColor={isDark ? "#525252" : "#DFD9D1"}
      />
    </View>
  );
}
