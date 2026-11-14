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

/**
 * Board tab (spec 5.7.2): an opt-in weekly cohort ranked by consistency points the server computes.
 * Opening the tab places a joined user in this week's cohort, which starts on the user's own week
 * start (BRD-01, STR-28). Offline it shows the last saved standings with their date (SB-01). Every
 * request runs as the account this screen belongs to (lib/social/owner.ts).
 */
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
  // Moves on at local midnight, so a tab left open overnight asks for the new day (BRD-01).
  const today = useLocalToday();
  const [joinError, setJoinError] = useState<string | null>(null);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  const join = useMutation({
    mutationFn: async (choice: BoardJoinChoice) => {
      if (!inputs.data) throw new Error("Board inputs are not ready");
      // ETH-07: the server says whether joining as a minor left a matched halaqa, so the screen can.
      const { leftMatched } = await joinBoard({ ...choice, inputs: inputs.data, today }, requireSocialOwner(userId));
      return { leavesMatched: leftMatched };
    },
    onSuccess: async (result, choice) => {
      if (result.leavesMatched) setNotice(s.socialLeftMatched);
      await Promise.all([
        refresh(),
        reloadPrivacy(),
        // ETH-07: joining as a minor clears the photo on the server, so the signed-in profile reloads.
        choice.isMinor ? useAuthStore.getState().fetchProfile() : null,
      ]);
    },
    onError: (error) => {
      if (error instanceof ProfilePrivacyChangedError) {
        // Another device changed the age setting. The form reloads from the stored choice.
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
      {notice ? <SocialNotice message={notice} actionLabel={s.socialDismiss} onAction={() => setNotice(null)} /> : null}

      {loading ? (
        <StandingsSkeleton label={s.loading} />
      ) : !view ? (
        <SocialNotice
          icon={offline ? CloudOff : undefined}
          message={offline ? s.socialOfflineEmpty : board.error ? socialFailureMessage(board.error, s) : s.socialLoadFailed}
          actionLabel={offline ? undefined : s.socialTryAgain}
          onAction={offline ? undefined : () => void refresh()}
        />
      ) : view.status === "not_joined" ? (
        offline ? (
          <SocialNotice icon={CloudOff} message={s.socialOfflineEmpty} />
        ) : (
          // Mounted afresh on each reconnect, so it reads the stored choice again.
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
  return (
    <BoardJoin
      // A change to the stored choices starts the form again from them.
      key={`${stored.isMinor}:${stored.boardNickname ?? ""}`}
      initialNickname={stored.boardNickname}
      initialIsMinor={stored.isMinor}
      pending={pending}
      error={error}
      onJoin={(choice) => onJoin({ ...choice, expectedMinor: stored.isMinor })}
    />
  );
}
