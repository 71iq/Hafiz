import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useAuth } from "../../context/AuthContext";
import { useSync } from "../../hooks/useSync";
import { getStudyStats, type StudyStats } from "../../db/database";
import { supabase } from "../../lib/supabase";

export default function ProfileScreen() {
  const { user, loading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color="#1e40af" />
      </View>
    );
  }

  return user ? <LoggedInView /> : <AuthForm />;
}

// ─── Auth Form ───────────────────────────────────────────────

function AuthForm() {
  const { signIn, signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    const err = isSignUp
      ? await signUp(email.trim(), password)
      : await signIn(email.trim(), password);
    setSubmitting(false);
    if (err) setError(err);
  };

  return (
    <ScrollView
      className="flex-1 px-6"
      contentContainerClassName="pt-8 pb-12"
      keyboardShouldPersistTaps="handled"
    >
      <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2 text-center">
        {isSignUp ? "Create Account" : "Sign In"}
      </Text>
      <Text className="text-gray-500 dark:text-gray-400 text-center mb-8">
        Sync your study progress across devices
      </Text>

      <Text className="text-sm text-gray-600 dark:text-gray-400 mb-1 ml-1">
        Email
      </Text>
      <TextInput
        className="border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 mb-4 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800"
        placeholder="you@example.com"
        placeholderTextColor="#9ca3af"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />

      <Text className="text-sm text-gray-600 dark:text-gray-400 mb-1 ml-1">
        Password
      </Text>
      <TextInput
        className="border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 mb-6 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800"
        placeholder="Min 6 characters"
        placeholderTextColor="#9ca3af"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {error && (
        <Text className="text-red-500 text-center mb-4">{error}</Text>
      )}

      <Pressable
        className="bg-blue-600 rounded-lg py-3 items-center mb-4"
        onPress={handleSubmit}
        disabled={submitting || !email || !password}
        style={{ opacity: submitting || !email || !password ? 0.5 : 1 }}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-white font-semibold text-base">
            {isSignUp ? "Sign Up" : "Sign In"}
          </Text>
        )}
      </Pressable>

      <Pressable onPress={() => setIsSignUp((v) => !v)}>
        <Text className="text-blue-600 dark:text-blue-400 text-center">
          {isSignUp
            ? "Already have an account? Sign In"
            : "Don't have an account? Sign Up"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

// ─── Logged In View ──────────────────────────────────────────

function LoggedInView() {
  const db = useSQLiteContext();
  const { user, signOut } = useAuth();
  const { sync, syncing, lastSync, error: syncError } = useSync();
  const [stats, setStats] = useState<StudyStats>({ cards_studied: 0, total_reviews: 0 });
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    (async () => {
      setStats(await getStudyStats(db));
    })();
  }, [db, syncing]); // refresh after sync completes

  // Load display name from profile
  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (data?.display_name) setDisplayName(data.display_name);
      });
  }, [user]);

  const saveDisplayName = useCallback(async () => {
    if (!user || !displayName.trim()) return;
    setSavingName(true);
    await supabase
      .from("profiles")
      .update({ display_name: displayName.trim() })
      .eq("id", user.id);
    setSavingName(false);
  }, [user, displayName]);

  return (
    <ScrollView
      className="flex-1 px-6"
      contentContainerClassName="pt-8 pb-12"
      keyboardShouldPersistTaps="handled"
    >
      <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1 text-center">
        Profile
      </Text>
      <Text className="text-gray-500 dark:text-gray-400 text-center mb-6">
        {user?.email}
      </Text>

      {/* Display Name */}
      <Text className="text-sm text-gray-600 dark:text-gray-400 mb-1 ml-1">
        Display Name
      </Text>
      <View className="flex-row items-center mb-8 gap-2">
        <TextInput
          className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800"
          placeholder="How others see you"
          placeholderTextColor="#9ca3af"
          value={displayName}
          onChangeText={setDisplayName}
          maxLength={40}
          onBlur={saveDisplayName}
        />
        {savingName && <ActivityIndicator size="small" color="#2563eb" />}
      </View>

      {/* Stats */}
      <View className="flex-row gap-4 mb-8">
        <View className="flex-1 bg-blue-50 dark:bg-blue-950 rounded-xl p-4 items-center">
          <Text className="text-3xl font-bold text-blue-700 dark:text-blue-300">
            {stats.cards_studied}
          </Text>
          <Text className="text-sm text-blue-600 dark:text-blue-400 mt-1">
            Cards Studied
          </Text>
        </View>
        <View className="flex-1 bg-green-50 dark:bg-green-950 rounded-xl p-4 items-center">
          <Text className="text-3xl font-bold text-green-700 dark:text-green-300">
            {stats.total_reviews}
          </Text>
          <Text className="text-sm text-green-600 dark:text-green-400 mt-1">
            Total Reviews
          </Text>
        </View>
      </View>

      {/* Sync */}
      <Pressable
        className="bg-blue-600 rounded-lg py-3 items-center mb-3"
        onPress={sync}
        disabled={syncing}
        style={{ opacity: syncing ? 0.5 : 1 }}
      >
        {syncing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-white font-semibold text-base">Sync Now</Text>
        )}
      </Pressable>

      {lastSync && (
        <Text className="text-gray-400 dark:text-gray-500 text-center text-sm mb-2">
          Last synced: {lastSync.toLocaleTimeString()}
        </Text>
      )}

      {syncError && (
        <Text className="text-red-500 text-center text-sm mb-4">
          {syncError}
        </Text>
      )}

      {/* Sign Out */}
      <Pressable
        className="border border-gray-300 dark:border-gray-600 rounded-lg py-3 items-center mt-4"
        onPress={signOut}
      >
        <Text className="text-gray-700 dark:text-gray-300 font-semibold text-base">
          Sign Out
        </Text>
      </Pressable>
    </ScrollView>
  );
}
