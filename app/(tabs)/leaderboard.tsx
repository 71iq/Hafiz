import { useState } from "react";
import { RefreshControl } from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudOff, Trophy } from "lucide-react-native";
import { BoardJoin } from "@/components/social/BoardJoin";
import { BoardStandings } from "@/components/social/BoardStandings";
import { SocialGate, SocialNotice } from "@/components/social/SocialControls";
import { SocialScreen } from "@/components/social/SocialScreen";
import { StandingsSkeleton } from "@/components/social/SocialSkeletons";
import { useAuthStore } from "@/lib/auth/store";
import { boardKeys, boardRead, joinBoard, leaveBoard } from "@/lib/board/api";
import { useDatabase } from "@/lib/database/provider";
import { localDateOf } from "@/lib/habit/dates";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { fetchProfilePrivacy, profilePrivacyKeys } from "@/lib/profile/privacy";
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
  const today = localDateOf(new Date());
  const [joinError, setJoinError] = useState<string | null>(null);
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

  const privacy = useQuery({
    queryKey: profilePrivacyKeys.mine(userId),
    queryFn: () => fetchProfilePrivacy(requireSocialOwner(userId)),
    enabled: view?.status === "not_joined" && !offline,
    retry: false,
    networkMode: "always",
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: boardKeys.all(userId) });

  const join = useMutation({
    mutationFn: (choice: { nickname: string | null; isMinor: boolean }) => {
      if (!inputs.data) throw new Error("Board inputs are not ready");
      return joinBoard({ ...choice, inputs: inputs.data, today }, requireSocialOwner(userId));
    },
    onSuccess: async (_result, choice) => {
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: profilePrivacyKeys.mine(userId) }),
        // ETH-07: joining as a minor clears the photo on the server, so the signed-in profile reloads.
        choice.isMinor ? useAuthStore.getState().fetchProfile() : null,
      ]);
    },
    onError: (error) => setJoinError(socialFailureMessage(error, s)),
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
      refreshControl={<RefreshControl refreshing={board.isRefetching} onRefresh={() => void refresh()} />}
    >
      {savedAt ? (
        <SocialNotice icon={CloudOff} message={interpolate(s.socialCachedAt, { date: formatSocialDate(savedAt, language, true) })} />
      ) : null}
      {leaveError ? <SocialNotice message={leaveError} actionLabel={s.socialDismiss} onAction={() => setLeaveError(null)} /> : null}

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
        <BoardJoin
          key={privacy.dataUpdatedAt}
          initialNickname={privacy.data?.boardNickname ?? null}
          initialIsMinor={privacy.data?.isMinor ?? false}
          pending={join.isPending || !inputs.data}
          error={joinError}
          onJoin={(choice) => {
            setJoinError(null);
            join.mutate(choice);
          }}
        />
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
