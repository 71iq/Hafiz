import { useState, useEffect, useCallback } from "react";
import { View, ActivityIndicator, ScrollView } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "../../context/AuthContext";
import { useSync } from "../../hooks/useSync";
import { getStudyStats, type StudyStats } from "../../db/database";
import { supabase } from "../../lib/supabase";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Text } from "../ui/text";
import { Card, CardContent } from "../ui/card";
import { FormField } from "../ui/form";

export default function ProfileScreen() {
  const { user, loading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color="hsl(var(--primary))" />
      </View>
    );
  }

  return user ? <LoggedInView /> : <AuthForm />;
}

// ─── Auth Form ───────────────────────────────────────────────

const authSchema = z.object({
  email: z.string().min(1, "Email is required").email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type AuthFormValues = z.infer<typeof authSchema>;

function AuthForm() {
  const { signIn, signUp } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { control, handleSubmit, reset } = useForm<AuthFormValues>({
    resolver: zodResolver(authSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (data: AuthFormValues) => {
    setServerError(null);
    setSubmitting(true);
    const err = isSignUp
      ? await signUp(data.email.trim(), data.password)
      : await signIn(data.email.trim(), data.password);
    setSubmitting(false);
    if (err) setServerError(err);
  };

  const toggleMode = () => {
    setIsSignUp((v) => !v);
    setServerError(null);
    reset();
  };

  return (
    <ScrollView
      className="flex-1 px-6"
      contentContainerClassName="pt-8 pb-12"
      keyboardShouldPersistTaps="handled"
    >
      <Text className="text-2xl font-bold text-foreground mb-2 text-center">
        {isSignUp ? "Create Account" : "Sign In"}
      </Text>
      <Text variant="muted" className="text-center mb-8">
        Sync your study progress across devices
      </Text>

      <FormField
        control={control}
        name="email"
        label="Email"
        placeholder="you@example.com"
        autoCapitalize="none"
        keyboardType="email-address"
        className="mb-4"
      />

      <FormField
        control={control}
        name="password"
        label="Password"
        placeholder="Min 6 characters"
        secureTextEntry
        className="mb-6"
      />

      {serverError && (
        <Text variant="destructive" className="text-center mb-4">{serverError}</Text>
      )}

      <Button
        onPress={handleSubmit(onSubmit)}
        disabled={submitting}
        className="mb-4"
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          isSignUp ? "Sign Up" : "Sign In"
        )}
      </Button>

      <Button variant="link" onPress={toggleMode}>
        {isSignUp
          ? "Already have an account? Sign In"
          : "Don't have an account? Sign Up"}
      </Button>
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
  }, [db, syncing]);

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
      <Text className="text-2xl font-bold text-foreground mb-1 text-center">
        Profile
      </Text>
      <Text variant="muted" className="text-center mb-6">
        {user?.email}
      </Text>

      {/* Display Name */}
      <Text variant="muted" className="text-sm mb-1 ml-1">Display Name</Text>
      <View className="flex-row items-center mb-8 gap-2">
        <Input
          className="flex-1"
          placeholder="How others see you"
          value={displayName}
          onChangeText={setDisplayName}
          maxLength={40}
          onBlur={saveDisplayName}
        />
        {savingName && <ActivityIndicator size="small" color="hsl(var(--primary))" />}
      </View>

      {/* Stats */}
      <View className="flex-row gap-4 mb-8">
        <Card className="flex-1 bg-blue-50 dark:bg-blue-950 border-0">
          <CardContent className="items-center">
            <Text className="text-3xl font-bold text-blue-700 dark:text-blue-300">
              {stats.cards_studied}
            </Text>
            <Text className="text-sm text-blue-600 dark:text-blue-400 mt-1">
              Cards Studied
            </Text>
          </CardContent>
        </Card>
        <Card className="flex-1 bg-green-50 dark:bg-green-950 border-0">
          <CardContent className="items-center">
            <Text className="text-3xl font-bold text-green-700 dark:text-green-300">
              {stats.total_reviews}
            </Text>
            <Text className="text-sm text-green-600 dark:text-green-400 mt-1">
              Total Reviews
            </Text>
          </CardContent>
        </Card>
      </View>

      {/* Sync */}
      <Button onPress={sync} disabled={syncing} className="mb-3">
        {syncing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          "Sync Now"
        )}
      </Button>

      {lastSync && (
        <Text variant="muted" className="text-center text-sm mb-2">
          Last synced: {lastSync.toLocaleTimeString()}
        </Text>
      )}

      {syncError && (
        <Text variant="destructive" className="text-center text-sm mb-4">
          {syncError}
        </Text>
      )}

      {/* Sign Out */}
      <Button variant="outline" onPress={signOut} className="mt-4">
        Sign Out
      </Button>
    </ScrollView>
  );
}
