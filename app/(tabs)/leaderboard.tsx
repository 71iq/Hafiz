import { useState } from "react";
import { RefreshControl } from "react-native";
import { Redirect, router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudOff, Trophy } from "lucide-react-native";
import { BoardJoin } from "@/components/social/BoardJoin";
import { BoardStandings } from "@/components/social/BoardStandings";
import { SocialGate, SocialNotice } from "@/components/social/SocialControls";
import { SocialScreen } from "@/components/social/SocialScreen";
import { BoardJoinSkeleton, StandingsSkeleton } from "@/components/social/SocialSkeletons";
import { useAuthStore } from "@/lib/auth/store";
import { boardKeys, boardRead, joinBoard, leaveBoard } from "@/lib/board/api";
import { isBoardEnabled } from "@/lib/board/config";
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

/**
 * Board tab (spec 5.7.2): an opt-in weekly cohort ranked by consistency points the server computes.
 * Opening the tab places a joined user in this week's cohort, which starts on the user's own week
 * start (BRD-01, STR-28). Offline it shows the last saved standings with their date (SB-01). Every
 * request runs as the account this screen belongs to (lib/social/owner.ts).
 */
export default function BoardScreen() {
  const s = useStrings();
  const user = useAuthStore((state) => state.user);

  // Hidden until enough people use Hafiz (lib/board/config.ts): an old link or return opens Home.
  if (!isBoardEnabled()) return <Redirect href="/(tabs)/home" />;

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
  // Moves on at local midnight, so a tab left open overnight asks for the new day (BRD-01).
  const today = useLocalToday();
  const [joinError, setJoinError] = useState<string | null>(null);
  // The choices of a join that failed, so the form comes back as the person left it.
  const [retryChoice, setRetryChoice] = useState<BoardJoinChoice | null>(null);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  // Bands come from the local plan and memorized cards (8.13), and the week start from the wird
  // settings; the server picks the cohort.
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

  // Join and Leave act at once: the screen moves to its next state while the request runs (the
  // mutation stays pending through the refetch that brings the server's view), and a failure moves
  // it back with the reason.
  const join = useMutation({
    mutationFn: async (choice: BoardJoinChoice) => {
      if (!inputs.data) throw new Error("Board inputs are not ready");
      await joinBoard({ ...choice, inputs: inputs.data, today }, requireSocialOwner(userId));
    },
    onSuccess: async (_result, choice) => {
      setRetryChoice(null);
      await Promise.all([
        refresh(),
        reloadPrivacy(),
        // ETH-07: joining as a minor clears the photo on the server, so the signed-in profile reloads.
        choice.isMinor ? useAuthStore.getState().fetchProfile() : null,
      ]);
    },
    onError: (error, choice) => {
      if (error instanceof ProfilePrivacyChangedError) {
        // Another device changed the age setting. The form reloads from the stored choice.
        setRetryChoice(null);
        setJoinError(s.socialErrorPrivacyChanged);
        void reloadPrivacy();
        return;
      }
      setRetryChoice(choice);
      setJoinError(socialFailureMessage(error, s));
    },
  });

  const leave = useMutation({
    mutationFn: () => leaveBoard(requireSocialOwner(userId)),
    onSuccess: async () => {
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: profilePrivacyKeys.mine(userId) })]);
    },
    onError: (error) => setLeaveError(`${s.boardStillJoined} ${socialFailureMessage(error, s)}`),
  });

  const savedAt = board.data?.source === "cache" ? board.data.savedAt : null;
  const loading = inputs.isLoading || board.isLoading;
  // Leaving shows the join form at once; the standings come back if the server refuses.
  const shownView = view && view.status !== "not_joined" && leave.isPending ? { status: "not_joined" as const, weekStart: view.weekStart } : view;

  return (
    <SocialScreen
      title={s.boardTitle}
      subtitle={s.boardSubtitle}
      refreshControl={
        <RefreshControl
          refreshing={board.isRefetching}
          onRefresh={() => {
            void refresh();
            // The stored age choice is read again with the rest of the screen.
            if (view?.status === "not_joined") void reloadPrivacy();
          }}
        />
      }
    >
      {savedAt ? (
        <SocialNotice icon={CloudOff} message={interpolate(s.socialCachedAt, { date: formatSocialDate(savedAt, language, true) })} />
      ) : null}
      {leaveError ? <SocialNotice message={leaveError} actionLabel={s.socialDismiss} onAction={() => setLeaveError(null)} /> : null}

      {loading ? (
        <StandingsSkeleton label={s.loading} />
      ) : !shownView ? (
        // Nothing private is shown without a current read; local study is unaffected.
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
      ) : shownView.status === "not_joined" ? (
        join.isPending ? (
          // Joined at once: the Board loads while the server places this account in a group.
          <StandingsSkeleton label={s.loading} />
        ) : offline ? (
          <SocialNotice icon={CloudOff} message={s.socialOfflineEmpty} />
        ) : (
          // Mounted afresh on each reconnect, so it reads the stored choice again. Join stays off
          // until a Leave on its way has finished, so the two reach the server in order.
          <BoardJoinSection
            userId={userId}
            pending={leave.isPending || !inputs.data}
            error={joinError}
            retryChoice={retryChoice}
            onJoin={(choice) => {
              setJoinError(null);
              setLeaveError(null);
              join.mutate(choice);
            }}
          />
        )
      ) : (
        <BoardStandings
          view={shownView}
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

/**
 * ETH-07: the join form starts from the account's stored age choice and sends it back as the value it
 * loaded, which the server compares. A cached copy can predate another device recording minority, so
 * the form appears only after a read that completed while this section is mounted, and gives way to
 * the skeleton while a read runs and to a retry after one fails.
 */
function BoardJoinSection({
  userId,
  pending,
  error,
  retryChoice,
  onJoin,
}: {
  userId: string;
  pending: boolean;
  error: string | null;
  /** A failed join's choices, shown again while the stored age choice is still the one it loaded. */
  retryChoice: BoardJoinChoice | null;
  onJoin: (choice: BoardJoinChoice) => void;
}) {
  const s = useStrings();
  const privacy = useQuery({
    queryKey: profilePrivacyKeys.mine(userId),
    queryFn: () => fetchProfilePrivacy(requireSocialOwner(userId)),
    retry: false,
    networkMode: "always",
    // Read again each time the section opens, even with a fresh cached copy.
    refetchOnMount: "always",
  });

  // ETH-07: the form starts only from a read that succeeded since the section opened, never from a
  // cached copy. After that it stays through later refetches and their failures, so a typed nickname
  // is kept: joining sends the minority the form loaded, and the server refuses it if that changed
  // since (privacy_changed). New stored values restart the form through its key.
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
  // ETH-07: a failed join's choices come back only while the stored age choice is the one that join
  // loaded; once another device records a change, the form starts from the stored choice again.
  const retry = retryChoice && retryChoice.expectedMinor === stored.isMinor ? retryChoice : null;
  const initial = retry ?? { nickname: stored.boardNickname, isMinor: stored.isMinor };
  return (
    <BoardJoin
      // A change to the stored choices, or a failed join, starts the form again from them.
      key={`${stored.isMinor}:${stored.boardNickname ?? ""}:${JSON.stringify(retry)}`}
      initialNickname={initial.nickname}
      initialIsMinor={initial.isMinor}
      pending={pending}
      error={error}
      onJoin={(choice) => onJoin({ ...choice, expectedMinor: stored.isMinor })}
    />
  );
}
