import { useState } from "react";
import { Platform, Pressable, RefreshControl, Share, View } from "react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudOff, Users } from "lucide-react-native";
import { EncouragementSheet } from "@/components/social/EncouragementSheet";
import { HalaqaGroup } from "@/components/social/HalaqaGroup";
import { HalaqaSharingSheet, type ProfileVisibilityChange } from "@/components/social/HalaqaSharingSheet";
import { HalaqaStart } from "@/components/social/HalaqaStart";
import { SocialGate, SocialNotice, socialRowStyle } from "@/components/social/SocialControls";
import { SocialScreen } from "@/components/social/SocialScreen";
import { HalaqaSkeleton } from "@/components/social/SocialSkeletons";
import { TeacherViewSheet } from "@/components/social/TeacherViewSheet";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Text } from "@/components/ui/Text";
import { useAuthStore } from "@/lib/auth/store";
import { boardKeys } from "@/lib/board/api";
import { useDatabase } from "@/lib/database/provider";
import { localDateOf } from "@/lib/habit/dates";
import {
  createInviteHalaqa,
  fetchTeacherView,
  halaqaDetailRead,
  halaqaKeys,
  joinHalaqaByCode,
  joinMatchedHalaqa,
  leaveHalaqa,
  myHalaqasRead,
  sendEncouragement,
  setHalaqaSharing,
  type EncouragementTemplateId,
  type HalaqaMember,
  type HalaqaSharing,
} from "@/lib/halaqa/api";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import {
  fetchProfilePrivacy,
  ProfilePrivacyChangedError,
  profilePrivacyKeys,
  saveProfilePrivacy,
} from "@/lib/profile/privacy";
import { useSettings } from "@/lib/settings/context";
import { socialFailureMessage } from "@/lib/social/messages";
import { requireSocialOwner } from "@/lib/social/owner";
import { readLocalSocialBands } from "@/lib/social/queries";
import { formatSocialDate } from "@/lib/social/text";
import { useIsOffline, useSocialQuery } from "@/lib/social/use-social-query";
import { isSupabaseConfigured } from "@/lib/supabase";

/**
 * Halaqa tab (spec 5.7.1). An online feature: offline it shows the last saved state with its date,
 * and wird, streak and plan never wait on it (SB-01). Every request runs as the account this screen
 * belongs to (lib/social/owner.ts), so a switch of account mid-request can neither show nor change
 * the other account's halaqas.
 */
export default function HalaqaScreen() {
  const s = useStrings();
  const user = useAuthStore((state) => state.user);

  if (!isSupabaseConfigured()) {
    return (
      <SocialScreen title={s.halaqaTitle} subtitle={s.halaqaSubtitle}>
        <SocialGate icon={Users} title={s.socialUnavailableTitle} body={s.socialUnconfigured} />
      </SocialScreen>
    );
  }
  if (!user) {
    return (
      <SocialScreen title={s.halaqaTitle} subtitle={s.halaqaSubtitle}>
        <SocialGate
          icon={Users}
          title={s.halaqaSignInTitle}
          body={s.halaqaSignInBody}
          signInLabel={s.socialSignIn}
          onSignIn={() => router.push("/auth/login" as never)}
        />
      </SocialScreen>
    );
  }
  // A new account starts with fresh screen state; query keys already carry the account id.
  return <HalaqaContent key={user.id} userId={user.id} />;
}

function HalaqaContent({ userId }: { userId: string }) {
  const s = useStrings();
  const db = useDatabase();
  const { isDark, isRTL, uiLanguage } = useSettings();
  const language = uiLanguage === "ar" ? "ar" : "en";
  const queryClient = useQueryClient();
  const offline = useIsOffline();
  const today = localDateOf(new Date());

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [encourageTarget, setEncourageTarget] = useState<HalaqaMember | null>(null);
  const [encourageError, setEncourageError] = useState<string | null>(null);
  const [teacherTarget, setTeacherTarget] = useState<HalaqaMember | null>(null);
  const [sharingOpen, setSharingOpen] = useState(false);
  const [sharingError, setSharingError] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const mine = useSocialQuery({
    queryKey: halaqaKeys.mine(userId),
    userId,
    cacheName: "halaqa-mine",
    read: myHalaqasRead(),
  });
  const groups = mine.data?.data ?? [];
  // The chosen halaqa while it is still listed, else the first one.
  const active = groups.find((group) => group.id === selectedId) ?? groups[0] ?? null;

  const detail = useSocialQuery({
    queryKey: halaqaKeys.detail(userId, active?.id ?? "none", today),
    userId,
    cacheName: `halaqa-detail:${active?.id ?? "none"}`,
    read: active ? halaqaDetailRead(active.id, today) : null,
  });

  // Read from the cache only: the app-wide minor check keeps it (useMinorPhotoCleanup), and the
  // sharing sheet reads it again each time it opens (HalaqaSharingPanel).
  const privacy = useQuery({
    queryKey: profilePrivacyKeys.mine(userId),
    queryFn: () => fetchProfilePrivacy(requireSocialOwner(userId)),
    enabled: false,
  });

  const teacherView = useQuery({
    queryKey: halaqaKeys.teacher(userId, active?.id ?? "none", teacherTarget?.userId ?? "none", today),
    queryFn: () => fetchTeacherView(active?.id ?? "", teacherTarget?.userId ?? "", today, requireSocialOwner(userId)),
    enabled: Boolean(active && teacherTarget) && !offline,
    retry: false,
    networkMode: "always",
    staleTime: 30_000,
  });

  const refreshAll = () => queryClient.invalidateQueries({ queryKey: halaqaKeys.all(userId) });

  const join = useMutation({
    mutationFn: async (action: { kind: "create"; name: string; asTeacher: boolean } | { kind: "code"; code: string } | { kind: "matched" }) => {
      const owner = requireSocialOwner(userId);
      switch (action.kind) {
        case "create":
          return createInviteHalaqa(action.name, action.asTeacher, owner);
        case "code":
          return joinHalaqaByCode(action.code, owner);
        case "matched":
          return joinMatchedHalaqa(await readLocalSocialBands(db), owner);
      }
    },
    onSuccess: async (group) => {
      setSelectedId(group.id);
      await refreshAll();
    },
  });

  const runJoin = async (action: Parameters<typeof join.mutateAsync>[0]): Promise<boolean> => {
    setStartError(null);
    try {
      await join.mutateAsync(action);
      return true;
    } catch (error) {
      setStartError(socialFailureMessage(error, s));
      return false;
    }
  };

  const encourage = useMutation({
    mutationFn: (choice: { templateId: EncouragementTemplateId | null; body: string | null }) =>
      sendEncouragement(
        {
          groupId: active?.id ?? "",
          toUserId: encourageTarget?.userId ?? "",
          templateId: choice.templateId,
          body: choice.body,
          today,
        },
        requireSocialOwner(userId),
      ),
    onSuccess: async () => {
      setEncourageTarget(null);
      await refreshAll();
    },
    onError: (error) => setEncourageError(socialFailureMessage(error, s)),
  });

  // ETH-07: the server takes a minor out of matched halaqas, so the matched join is not offered.
  const isMinor = privacy.data?.isMinor === true;
  const reloadPrivacy = () => queryClient.invalidateQueries({ queryKey: profilePrivacyKeys.mine(userId) });

  const saveSharing = useMutation({
    mutationFn: async (input: {
      sharing: HalaqaSharing;
      visibility: ProfileVisibilityChange | null;
      leavesMatched: boolean;
    }): Promise<{ leftBoard: boolean }> => {
      if (!active) return { leftBoard: false };
      // One owner for both writes: the second is refused before it is sent if the account changed.
      const owner = requireSocialOwner(userId);
      await setHalaqaSharing(active.id, input.sharing, owner);
      if (!input.visibility) return { leftBoard: false };
      // The server says whether recording minority took a Board member without a nickname off the Board.
      const saved = await saveProfilePrivacy(input.visibility, owner);
      return { leftBoard: saved.leftBoard };
    },
    onSuccess: async (result, input) => {
      setSharingOpen(false);
      // Saying one is under 18 leaves the matched halaqa, and the Board without a nickname (ETH-07,
      // BRD-07); the notice says so, not only "Saved".
      setNotice(
        input.leavesMatched && result.leftBoard
          ? s.socialSavedLeftBoth
          : result.leftBoard
            ? s.socialSavedLeftBoard
            : input.leavesMatched
              ? s.socialSavedLeftMatched
              : s.socialSaved,
      );
      await Promise.all([
        refreshAll(),
        reloadPrivacy(),
        // The Board tab reads whether the account is still on it.
        result.leftBoard ? queryClient.invalidateQueries({ queryKey: boardKeys.all(userId) }) : null,
        // ETH-07: stating minority clears the photo on the server, so the signed-in profile reloads.
        input.visibility?.isMinor ? useAuthStore.getState().fetchProfile() : null,
      ]);
    },
    onError: (error) => {
      if (error instanceof ProfilePrivacyChangedError) {
        // Another device changed the age setting. The sheet reloads it and the person decides again.
        setSharingError(s.socialErrorPrivacyChanged);
        void reloadPrivacy();
        return;
      }
      setSharingError(socialFailureMessage(error, s));
    },
  });

  const leave = useMutation({
    mutationFn: () => leaveHalaqa(active?.id ?? "", requireSocialOwner(userId)),
    onSuccess: async () => {
      setLeaveOpen(false);
      setSelectedId(null);
      await refreshAll();
    },
    onError: (error) => setLeaveError(socialFailureMessage(error, s)),
  });

  const shareCode = async (code: string) => {
    const message = interpolate(s.halaqaShareMessage, { code });
    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && !("share" in navigator)) {
        await Clipboard.setStringAsync(message);
        setNotice(s.halaqaCodeCopied);
        return;
      }
      await Share.share({ message });
    } catch {
      await Clipboard.setStringAsync(message).catch(() => undefined);
      setNotice(s.halaqaCodeCopied);
    }
  };

  const snapshot = detail.data ?? null;
  const savedAt = mine.data?.source === "cache" ? mine.data.savedAt : snapshot?.source === "cache" ? snapshot.savedAt : null;
  const loading = mine.isLoading || (active !== null && detail.isLoading);
  const loadError = mine.error ?? (active ? detail.error : null);
  const busy = join.isPending;

  return (
    <SocialScreen
      title={s.halaqaTitle}
      subtitle={s.halaqaSubtitle}
      refreshControl={
        <RefreshControl refreshing={mine.isRefetching || detail.isRefetching} onRefresh={() => void refreshAll()} />
      }
    >
      {savedAt ? (
        <SocialNotice icon={CloudOff} message={interpolate(s.socialCachedAt, { date: formatSocialDate(savedAt, language, true) })} />
      ) : null}
      {notice ? <SocialNotice message={notice} actionLabel={s.socialDismiss} onAction={() => setNotice(null)} /> : null}

      {groups.length > 1 ? (
        <View className="flex-wrap gap-2" style={socialRowStyle(isRTL)}>
          {groups.map((group) => {
            const name = group.kind === "matched" ? s.halaqaMatchedName : (group.name ?? s.halaqaMatchedName);
            const selected = group.id === active?.id;
            return (
              <Pressable
                key={group.id}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={interpolate(s.halaqaSwitchA11y, { name })}
                onPress={() => setSelectedId(group.id)}
                className={
                  selected
                    ? "min-h-11 justify-center rounded-full bg-primary-accent/15 px-4 dark:bg-primary-bright/15"
                    : "min-h-11 justify-center rounded-full bg-surface-mid px-4 dark:bg-surface-dark-mid"
                }
              >
                <Text variant="title-sm" className={selected ? "text-primary-muted dark:text-primary-bright" : undefined}>
                  {name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {loading ? (
        <HalaqaSkeleton label={s.loading} />
      ) : loadError && !mine.data ? (
        <SocialNotice
          icon={offline ? CloudOff : undefined}
          message={offline ? s.socialOfflineEmpty : socialFailureMessage(loadError, s)}
          actionLabel={offline ? undefined : s.socialTryAgain}
          onAction={offline ? undefined : () => void refreshAll()}
        />
      ) : groups.length === 0 ? (
        <HalaqaStart
          matchedAllowed={!isMinor}
          pending={busy}
          error={startError}
          onClearError={() => setStartError(null)}
          onCreate={(name, asTeacher) => runJoin({ kind: "create", name, asTeacher })}
          onJoinCode={(code) => runJoin({ kind: "code", code })}
          onJoinMatched={() => void runJoin({ kind: "matched" })}
        />
      ) : snapshot ? (
        <>
          <HalaqaGroup
            detail={snapshot.data}
            onEncourage={(member) => {
              setEncourageError(null);
              setEncourageTarget(member);
            }}
            onTeacherView={setTeacherTarget}
            onShareCode={(code) => void shareCode(code)}
            onOpenSharing={() => {
              setSharingError(null);
              setSharingOpen(true);
            }}
            onLeave={() => {
              setLeaveError(null);
              setLeaveOpen(true);
            }}
          />
          <HalaqaStart
            compact
            matchedAllowed={!isMinor}
            pending={busy}
            error={startError}
            onClearError={() => setStartError(null)}
            onCreate={(name, asTeacher) => runJoin({ kind: "create", name, asTeacher })}
            onJoinCode={(code) => runJoin({ kind: "code", code })}
            onJoinMatched={() => void runJoin({ kind: "matched" })}
          />
        </>
      ) : detail.error ? (
        <SocialNotice
          message={socialFailureMessage(detail.error, s)}
          actionLabel={s.socialTryAgain}
          onAction={() => void detail.refetch()}
        />
      ) : null}

      <EncouragementSheet
        recipientName={encourageTarget?.name ?? null}
        allowFreeText={active?.kind === "invite"}
        pending={encourage.isPending}
        error={encourageError}
        onSend={(choice) => {
          setEncourageError(null);
          encourage.mutate(choice);
        }}
        onClose={() => setEncourageTarget(null)}
      />

      <TeacherViewSheet
        memberName={teacherTarget?.name ?? null}
        view={teacherView.data ?? null}
        loading={teacherView.isLoading}
        error={
          offline && teacherTarget
            ? s.socialErrorOffline
            : teacherView.error
              ? socialFailureMessage(teacherView.error, s)
              : null
        }
        onClose={() => setTeacherTarget(null)}
      />

      {active && sharingOpen ? (
        <HalaqaSharingPanel
          // One sheet per open; a reconnect reads the stored choices again without dropping its drafts.
          key={active.id}
          userId={userId}
          offline={offline}
          sharing={active.sharing}
          pending={saveSharing.isPending}
          error={sharingError}
          onSave={(sharing, visibility) => {
            setSharingError(null);
            const leavesMatched =
              visibility?.isMinor === true && !visibility.expectedMinor && groups.some((group) => group.kind === "matched");
            saveSharing.mutate({ sharing, visibility, leavesMatched });
          }}
          onClose={() => setSharingOpen(false)}
        />
      ) : null}

      <ConfirmDialog
        visible={leaveOpen}
        title={s.halaqaLeaveTitle}
        message={s.halaqaLeaveBody}
        cancelLabel={s.socialCancel}
        confirmLabel={s.halaqaLeaveConfirm}
        destructive
        confirmLoading={leave.isPending}
        error={leaveError}
        isDark={isDark}
        isRTL={isRTL}
        onCancel={() => setLeaveOpen(false)}
        onConfirm={() => leave.mutate()}
      />
    </SocialScreen>
  );
}

/**
 * ETH-07: the sharing sheet saves the account's age choice with the value it loaded, which the server
 * compares. A cached copy can predate another device changing it, so the profile choices appear only
 * after a read that completed while this panel is open, and give way to a note while a read runs or
 * after one fails. The halaqa choices stay available either way.
 */
function HalaqaSharingPanel({
  userId,
  offline,
  sharing,
  pending,
  error,
  onSave,
  onClose,
}: {
  userId: string;
  offline: boolean;
  sharing: HalaqaSharing;
  pending: boolean;
  error: string | null;
  onSave: (sharing: HalaqaSharing, visibility: ProfileVisibilityChange | null) => void;
  onClose: () => void;
}) {
  const s = useStrings();
  const privacy = useQuery({
    queryKey: profilePrivacyKeys.mine(userId),
    queryFn: () => fetchProfilePrivacy(requireSocialOwner(userId)),
    enabled: !offline,
    retry: false,
    networkMode: "always",
    // Read again each time the sheet opens, even with a fresh cached copy.
    refetchOnMount: "always",
  });
  // ETH-07: the profile choices start only from a read that succeeded since the sheet opened. They
  // stay through later refetches; saving sends the minority they loaded, and the server refuses it if
  // that changed since (privacy_changed).
  const [verified, setVerified] = useState(false);
  const readSinceOpen = privacy.isFetchedAfterMount && privacy.isSuccess && !privacy.isFetching;
  if (readSinceOpen && !verified) setVerified(true);
  const fresh = (verified || readSinceOpen) && privacy.data ? privacy.data : null;
  const notice = fresh
    ? null
    : offline
      ? { message: s.socialErrorOffline }
      : privacy.isError && !privacy.isFetching
        ? { message: socialFailureMessage(privacy.error, s), onRetry: () => void privacy.refetch() }
        : { message: s.loading, loading: true };

  return (
    <HalaqaSharingSheet
      open
      sharing={sharing}
      privacy={fresh}
      privacyNotice={notice}
      pending={pending}
      error={error}
      onSave={onSave}
      onClose={onClose}
    />
  );
}
