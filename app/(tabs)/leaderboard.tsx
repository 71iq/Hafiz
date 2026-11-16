import { useState } from "react";
import { RefreshControl } from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudOff, Trophy } from "lucide-react-native";
import { BoardJoin } from "@/components/social/BoardJoin";
import { BoardStandings } from "@/components/social/BoardStandings";
import { SocialGate, SocialNotice } from "@/components/social/SocialControls";
import { SocialScreen } from "@/components/social/SocialScreen";
import { BoardJoinSkeleton, StandingsSkeleton } from "@/components/social/SocialSkeletons";
import { useAuthStore } from "@/lib/auth/store";
import { boardKeys, boardRead, joinBoard, leaveBoard } from "@/lib/board/api";
import { useDatabase } from "@/lib/database/provider";
import { useLocalToday } from "@/lib/habit/use-day-boundary";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { fetchProfilePrivacy, ProfilePrivacyChangedError, profilePrivacyKeys } from "@/lib/profile/privacy";
import { useSettings } from "@/lib/settings/context";
import { socialFailureMessage } from "@/lib/social/messages";
import { requireSocialOwner } from "@/lib/social/owner";
import { readLocalBoardInputs } from "@/lib/social/queries";
import { formatSocialDate } from "@/lib/social/text";
import { useIsOffline, useSocialQuery } from "@/lib/social/use-social-query";
import { isSupabaseConfigured } from "@/lib/supabase";

export default function BoardScreen() {
  const s = useStrings();
  const user = useAuthStore((state) => state.user);

  if (!isSupabaseConfigured()) {
    return (
      <SocialScreen title={s.boardTitle} subtitle={s.boardSubtitle}>
        <SocialGate icon={Trophy} title={s.socialUnavailableTitle} body={s.socialUnconfigured} />
      </SocialScreen>
    );
  }
  if (!user) {
    return (
      <SocialScreen title={s.boardTitle} subtitle={s.boardSubtitle}>
        <SocialGate
          icon={Trophy}
          title={s.boardSignInTitle}
          body={s.boardSignInBody}
          signInLabel={s.socialSignIn}
          onSignIn={() => router.push("/auth/login" as never)}
        />
      </SocialScreen>
    );
  }
  return <BoardContent key={user.id} userId={user.id} />;
}

function BoardContent({ userId }: { userId: string }) {
  const s = useStrings();
  const db = useDatabase();
  const { uiLanguage } = useSettings();
  const language = uiLanguage === "ar" ? "ar" : "en";
  const queryClient = useQueryClient();
  const offline = useIsOffline();
  const today = useLocalToday();
  const [joinError, setJoinError] = useState<string | null>(null);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const inputs = useQuery({
    queryKey: ["boardInputs", userId, today, language],
    queryFn: () => readLocalBoardInputs(db, language),
    staleTime: 5 * 60_000,
  });

  const board = useSocialQuery({
    queryKey: inputs.data ? boardKeys.view(userId, today, inputs.data) : boardKeys.all(userId),
    userId,
    cacheName: "board",
    read: inputs.data ? boardRead(inputs.data, today) : null,
  });
  const view = board.data?.data ?? null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: boardKeys.all(userId) });
  const reloadPrivacy = () => queryClient.invalidateQueries({ queryKey: profilePrivacyKeys.mine(userId) });

  const join = useMutation({
    mutationFn: async (choice: BoardJoinChoice) => {
      if (!inputs.data) throw new Error("Board inputs are not ready");
      const { leftMatched } = await joinBoard({ ...choice, inputs: inputs.data, today }, requireSocialOwner(userId));
      return { leavesMatched: leftMatched };
    },
    onSuccess: async (result, choice) => {
      if (result.leavesMatched) setNotice(s.socialLeftMatched);
      await Promise.all([
        refresh(),
        reloadPrivacy(),
        choice.isMinor ? useAuthStore.getState().fetchProfile() : null,
      ]);
    },
    onError: (error) => {
      if (error instanceof ProfilePrivacyChangedError) {
        setJoinError(s.socialErrorPrivacyChanged);
        void reloadPrivacy();
        return;
      }
      setJoinError(socialFailureMessage(error, s));
    },
  });

  const leave = useMutation({
    mutationFn: () => leaveBoard(requireSocialOwner(userId)),
    onSuccess: async () => {
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: profilePrivacyKeys.mine(userId) })]);
    },
    onError: (error) => setLeaveError(socialFailureMessage(error, s)),
  });

  const savedAt = board.data?.source === "cache" ? board.data.savedAt : null;
  const loading = inputs.isLoading || board.isLoading;

  return (
    <SocialScreen
      title={s.boardTitle}
      subtitle={s.boardSubtitle}
      refreshControl={
        <RefreshControl
          refreshing={board.isRefetching}
          onRefresh={() => {
            void refresh();
            if (view?.status === "not_joined") void reloadPrivacy();
          }}
        />
      }
    >
      {savedAt ? (
        <SocialNotice icon={CloudOff} message={interpolate(s.socialCachedAt, { date: formatSocialDate(savedAt, language, true) })} />
      ) : null}
      {leaveError ? <SocialNotice message={leaveError} actionLabel={s.socialDismiss} onAction={() => setLeaveError(null)} /> : null}
      {notice ? <SocialNotice message={notice} actionLabel={s.socialDismiss} onAction={() => setNotice(null)} /> : null}

      {loading ? (
        <StandingsSkeleton label={s.loading} />
      ) : !view ? (
        <SocialNotice
          icon={offline ? CloudOff : undefined}
          message={
            offline
              ? s.socialOfflineEmpty
              : `${board.error ? socialFailureMessage(board.error, s) : s.socialLoadFailed} ${s.boardLocalReassurance}`
          }
          actionLabel={offline ? undefined : s.socialTryAgain}
          onAction={offline ? undefined : () => void refresh()}
        />
      ) : view.status === "not_joined" ? (
        offline ? (
          <SocialNotice icon={CloudOff} message={s.socialOfflineEmpty} />
        ) : (
          <BoardJoinSection
            userId={userId}
            pending={join.isPending || !inputs.data}
            error={joinError}
            onJoin={(choice) => {
              setJoinError(null);
              join.mutate(choice);
            }}
          />
        )
      ) : (
        <BoardStandings
          view={view}
          leaving={leave.isPending}
          onLeave={() => {
            setLeaveError(null);
            leave.mutate();
          }}
        />
      )}
    </SocialScreen>
  );
}

type BoardJoinChoice = { nickname: string | null; isMinor: boolean; expectedMinor: boolean };

function BoardJoinSection({
  userId,
  pending,
  error,
  onJoin,
}: {
  userId: string;
  pending: boolean;
  error: string | null;
  onJoin: (choice: BoardJoinChoice) => void;
}) {
  const s = useStrings();
  const privacy = useQuery({
    queryKey: profilePrivacyKeys.mine(userId),
    queryFn: () => fetchProfilePrivacy(requireSocialOwner(userId)),
    retry: false,
    networkMode: "always",
    refetchOnMount: "always",
  });

  const [verified, setVerified] = useState(false);
  const readSinceOpen = privacy.isFetchedAfterMount && privacy.isSuccess && !privacy.isFetching;
  if (readSinceOpen && !verified) setVerified(true);
  const stored = (verified || readSinceOpen) && privacy.data ? privacy.data : null;
  if (!stored) {
    if (privacy.isError && !privacy.isFetching) {
      return (
        <SocialNotice
          message={socialFailureMessage(privacy.error, s)}
          actionLabel={s.socialTryAgain}
          onAction={() => void privacy.refetch()}
        />
      );
    }
    return <BoardJoinSkeleton label={s.loading} />;
  }
  return (
    <BoardJoin
      key={`${stored.isMinor}:${stored.boardNickname ?? ""}`}
      initialNickname={stored.boardNickname}
      initialIsMinor={stored.isMinor}
      pending={pending}
      error={error}
      onJoin={(choice) => onJoin({ ...choice, expectedMinor: stored.isMinor })}
    />
  );
}
