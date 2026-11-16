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
import { useLocalToday } from "@/lib/habit/use-day-boundary";
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
  setHalaqaMemberRole,
  setHalaqaSharing,
  type EncouragementTemplateId,
  type HalaqaMember,
  type HalaqaSharing,
} from "@/lib/halaqa/api";
import { clearSabaqAssignment, forgetMySabaqAssignment, setSabaqAssignment } from "@/lib/halaqa/sabaq-assignment";
import type { AssignedSabaq } from "@/lib/hifz/sabaq";
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
  return <HalaqaContent key={user.id} userId={user.id} />;
}

function HalaqaContent({ userId }: { userId: string }) {
  const s = useStrings();
  const db = useDatabase();
  const { isDark, isRTL, uiLanguage } = useSettings();
  const language = uiLanguage === "ar" ? "ar" : "en";
  const queryClient = useQueryClient();
  const offline = useIsOffline();
  const today = useLocalToday();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [encourageTarget, setEncourageTarget] = useState<HalaqaMember | null>(null);
  const [encourageError, setEncourageError] = useState<string | null>(null);
  const [teacherTarget, setTeacherTarget] = useState<HalaqaMember | null>(null);
  const [roleTarget, setRoleTarget] = useState<HalaqaMember | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
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
  const active = groups.find((group) => group.id === selectedId) ?? groups[0] ?? null;

  const detail = useSocialQuery({
    queryKey: halaqaKeys.detail(userId, active?.id ?? "none", today),
    userId,
    cacheName: `halaqa-detail:${active?.id ?? "none"}`,
    read: active ? halaqaDetailRead(active.id, today) : null,
  });

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

  const isMinor = privacy.data?.isMinor === true;
  const reloadPrivacy = () => queryClient.invalidateQueries({ queryKey: profilePrivacyKeys.mine(userId) });

  const saveSharing = useMutation({
    mutationFn: async (input: {
      sharing: HalaqaSharing;
      visibility: ProfileVisibilityChange | null;
      leavesMatched: boolean;
    }): Promise<{ leftBoard: boolean }> => {
      if (!active) return { leftBoard: false };
      const owner = requireSocialOwner(userId);
      await setHalaqaSharing(active.id, input.sharing, owner);
      if (!input.sharing.planWithTeachers) await forgetMySabaqAssignment(userId);
      if (!input.visibility) return { leftBoard: false };
      const saved = await saveProfilePrivacy(input.visibility, owner);
      return { leftBoard: saved.leftBoard };
    },
    onSuccess: async (result, input) => {
      setSharingOpen(false);
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
        result.leftBoard ? queryClient.invalidateQueries({ queryKey: boardKeys.all(userId) }) : null,
        input.visibility?.isMinor ? useAuthStore.getState().fetchProfile() : null,
      ]);
    },
    onError: (error) => {
      if (error instanceof ProfilePrivacyChangedError) {
        setSharingError(s.socialErrorPrivacyChanged);
        void reloadPrivacy();
        return;
      }
      setSharingError(socialFailureMessage(error, s));
    },
  });

  const leave = useMutation({
    mutationFn: async () => {
      await leaveHalaqa(active?.id ?? "", requireSocialOwner(userId));
      await forgetMySabaqAssignment(userId);
    },
    onSuccess: async () => {
      setLeaveOpen(false);
      setSelectedId(null);
      await refreshAll();
    },
    onError: (error) => setLeaveError(socialFailureMessage(error, s)),
  });

  const roleMutationKey = [...halaqaKeys.all(userId), "set-role"];
  const changeRole = useMutation({
    mutationKey: roleMutationKey,
    mutationFn: (member: HalaqaMember) =>
      setHalaqaMemberRole(
        active?.id ?? "",
        member.userId,
        member.role === "teacher" ? "member" : "teacher",
        requireSocialOwner(userId),
      ),
    onSuccess: async () => {
      await refreshAll();
      setRoleTarget(null);
    },
    onError: (error) => setRoleError(socialFailureMessage(error, s)),
  });
  const removesTeacher = roleTarget?.role === "teacher";
  const roleName = { name: roleTarget?.name ?? "" };

  type AssignOutcome = { groupId: string; memberId: string; saved: string | null; error: string | null };
  const [assignOutcome, setAssignOutcome] = useState<AssignOutcome | null>(null);
  const assignMutationKey = [...halaqaKeys.all(userId), "sabaq-assignment"];
  const assignSabaq = useMutation({
    mutationKey: assignMutationKey,
    mutationFn: async (change: { groupId: string; memberId: string; range: AssignedSabaq | null }) => {
      const owner = requireSocialOwner(userId);
      if (change.range) await setSabaqAssignment({ groupId: change.groupId, memberId: change.memberId, ...change.range }, owner);
      else await clearSabaqAssignment(change.groupId, change.memberId, owner);
    },
    onSuccess: (_, change) =>
      setAssignOutcome({
        groupId: change.groupId,
        memberId: change.memberId,
        saved: change.range ? s.teacherAssignSaved : s.teacherAssignCleared,
        error: null,
      }),
    onError: (error, change) =>
      setAssignOutcome({ groupId: change.groupId, memberId: change.memberId, saved: null, error: socialFailureMessage(error, s) }),
    onSettled: (_, __, change) =>
      queryClient.invalidateQueries({ queryKey: halaqaKeys.teacher(userId, change.groupId, change.memberId, today) }),
  });
  const changeAssignment = (range: AssignedSabaq | null) => {
    if (!active || !teacherTarget || queryClient.isMutating({ mutationKey: assignMutationKey }) > 0) return;
    setAssignOutcome(null);
    assignSabaq.mutate({ groupId: active.id, memberId: teacherTarget.userId, range });
  };
  const openTeacherView = (member: HalaqaMember | null) => {
    setAssignOutcome(null);
    setTeacherTarget(member);
  };
  const shownOutcome =
    assignOutcome && assignOutcome.groupId === active?.id && assignOutcome.memberId === teacherTarget?.userId
      ? assignOutcome
      : null;

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
            rolePending={changeRole.isPending}
            onEncourage={(member) => {
              setEncourageError(null);
              setEncourageTarget(member);
            }}
            onTeacherView={openTeacherView}
            onChangeRole={(member) => {
              setRoleError(null);
              setRoleTarget(member);
            }}
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
        assign={{
          pending: assignSabaq.isPending,
          error: shownOutcome?.error ?? null,
          saved: shownOutcome?.saved ?? null,
          disabled: offline,
          onSave: (range) => changeAssignment(range),
          onClear: () => changeAssignment(null),
        }}
        onClose={() => openTeacherView(null)}
      />

      {active && sharingOpen ? (
        <HalaqaSharingPanel
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

      <ConfirmDialog
        visible={roleTarget !== null}
        title={interpolate(removesTeacher ? s.halaqaRemoveTeacherTitle : s.halaqaMakeTeacherTitle, roleName)}
        message={removesTeacher ? s.halaqaRemoveTeacherBody : s.halaqaMakeTeacherBody}
        cancelLabel={s.socialCancel}
        confirmLabel={removesTeacher ? s.halaqaRemoveTeacherConfirm : s.halaqaMakeTeacherConfirm}
        tone="neutral"
        confirmLoading={changeRole.isPending}
        error={roleError}
        isDark={isDark}
        isRTL={isRTL}
        onCancel={() => setRoleTarget(null)}
        onConfirm={() => {
          if (!roleTarget || queryClient.isMutating({ mutationKey: roleMutationKey }) > 0) return;
          setRoleError(null);
          changeRole.mutate(roleTarget);
        }}
      />
    </SocialScreen>
  );
}

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
    refetchOnMount: "always",
  });
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
