#!/usr/bin/env bash
# Two-session race tests for 20261113120000_learning_consistency.sql. run-learning-consistency.sh
# calls this with its disposable, network-less container after learning_consistency.test.sql.
#
# Each race holds the lock a fixed function must wait on, starts the competing sessions, and only
# lets go once the expected number of sessions is blocked on a lock (or after 10 seconds, so code
# that skips the lock runs into the race instead of hanging). Then it checks the committed state.
# pg_stat_activity is read once per transaction unless pg_stat_clear_snapshot() runs, so every
# polling loop clears it.
#
# Usage: bash supabase/tests/learning_consistency_races.sh <container>
set -euo pipefail
C="$1"
WORK="$(mktemp -d)"
trap 'wait 2>/dev/null; rm -rf "$WORK"' EXIT

admin() { docker exec -i "$C" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qtA "$@"; }

# psql input that signs in as $1, as PostgREST would, and then runs $2.
as_user() {
  printf "\\o /dev/null\nSELECT set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\"}', false);\n\\o\nSET ROLE authenticated;\n%s\n" "$1" "$2"
}

# Runs SQL as `uid` in its own session in the background. The file gets its output and a last line
# "ok" or "failed".
session() {
  local name="$1" uid="$2" sql="$3"
  {
    if as_user "$uid" "$sql" | docker exec -i -e PGAPPNAME="race_$name" "$C" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA \
      >"$WORK/$name" 2>&1; then
      echo ok >>"$WORK/$name"
    else
      echo failed >>"$WORK/$name"
    fi
  } &
}

# Blocks until `n` race sessions wait on a lock, for at most 10 seconds.
wait_for_waiters() {
  admin -c "DO \$\$ BEGIN
    FOR i IN 1 .. 200 LOOP
      PERFORM pg_stat_clear_snapshot();
      EXIT WHEN (SELECT count(*) FROM pg_stat_activity
        WHERE application_name LIKE 'race\\_%' AND wait_event_type = 'Lock') >= $1;
      PERFORM pg_sleep(0.05);
    END LOOP;
  END \$\$;" >/dev/null
}

# A controller session: takes a lock with `lock_sql`, waits for `n` blocked sessions, then commits.
controller() {
  local name="$1" lock_sql="$2" n="$3"
  {
    docker exec -i -e PGAPPNAME="ctl_$name" "$C" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qtA >/dev/null 2>&1 <<SQL
BEGIN;
$lock_sql
DO \$\$ BEGIN
  FOR i IN 1 .. 200 LOOP
      PERFORM pg_stat_clear_snapshot();
    EXIT WHEN (SELECT count(*) FROM pg_stat_activity
      WHERE application_name LIKE 'race\\_%' AND wait_event_type = 'Lock') >= $n;
    PERFORM pg_sleep(0.05);
  END LOOP;
END \$\$;
COMMIT;
SQL
  } &
}

# Waits until the controller named `name` holds its lock.
wait_for_controller() {
  admin -c "DO \$\$ BEGIN
    FOR i IN 1 .. 200 LOOP
      PERFORM pg_stat_clear_snapshot();
      EXIT WHEN EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'ctl_$1' AND query LIKE 'DO %');
      PERFORM pg_sleep(0.05);
    END LOOP;
  END \$\$;" >/dev/null
}

check() {
  local label="$1" actual="$2" expected="$3"
  if [ "$actual" != "$expected" ]; then
    echo "race check failed: $label: expected [$expected], got [$actual]" >&2
    for f in "$WORK"/*; do echo "--- $(basename "$f")" >&2; cat "$f" >&2; done
    exit 1
  fi
  echo "race ok: $label"
}

uid() { printf '00000000-0000-4000-8009-%012d' "$1"; }

admin >/dev/null <<SQL
INSERT INTO auth.users (id, email) SELECT ('00000000-0000-4000-8009-' || lpad(i::TEXT, 12, '0'))::UUID, 'race' || i || '@example.invalid'
FROM generate_series(1, 6) AS i;
INSERT INTO public.profiles (id, username) SELECT ('00000000-0000-4000-8009-' || lpad(i::TEXT, 12, '0'))::UUID, 'race_user_' || i
FROM generate_series(1, 6) AS i;
SQL

TODAY="$(admin -c "SELECT to_char((now() AT TIME ZONE 'UTC')::DATE, 'YYYY-MM-DD')")"

# ─── Finding 3: a board read in flight cannot undo leaving ───────────────────────
# User 1 is on the board with no cohort this week (another reader's pass considered them for the
# week but they had not studied yet), and their stored bands match this read, so the read changes
# nothing in their privacy row before it must place them. The controller holds the week's placement
# lock: the read waits on it while holding the user's privacy row lock, and the leave waits on that
# row. Without the shared row lock, the leave would finish first and the waiting read would then
# place a user who has left.
WEEK="$(admin -c "SELECT private.board_week((now() AT TIME ZONE 'UTC')::DATE, 5)")"
admin -c "INSERT INTO public.profile_privacy (user_id, board_joined, board_week_start, board_level_band, board_pace_band,
  board_utc_offset_minutes, board_enrolled_week) VALUES ('$(uid 1)', true, 5, 'juz_amma', 'light', 180, DATE '$WEEK')" >/dev/null
controller board "SELECT pg_advisory_xact_lock(hashtextextended('hafiz:board:' || DATE '$WEEK'::TEXT, 0));" 2
wait_for_controller board
session board_read "$(uid 1)" "SELECT public.get_board('juz_amma', 'light', 180, '$TODAY', 5)->>'status';"
wait_for_waiters 1
session board_leave "$(uid 1)" "SELECT public.leave_board();"
wait
check "board read finished" "$(tail -1 "$WORK/board_read")" ok
check "leave finished" "$(tail -1 "$WORK/board_leave")" ok
check "left user is off the board" \
  "$(admin -c "SELECT board_joined FROM public.profile_privacy WHERE user_id = '$(uid 1)'")" f
check "left user has no active cohort" \
  "$(admin -c "SELECT count(*) FROM public.board_members WHERE user_id = '$(uid 1)' AND left_at IS NULL")" 0

# ─── Finding 9: two matched joins by one user make one membership ─────────────
# The controller holds the global matching lock. With the per-user lock, the first request waits on
# the matching lock and the second on the user lock; the second then finds the first's membership.
rm -f "$WORK"/*
controller matched "SELECT pg_advisory_xact_lock(hashtextextended('hafiz:matched-halaqa', 0));" 2
wait_for_controller matched
session matched_1 "$(uid 2)" "SELECT public.join_matched_halaqa('juz_amma', 'light', 180)->>'id';"
session matched_2 "$(uid 2)" "SELECT public.join_matched_halaqa('juz_amma', 'light', 180)->>'id';"
wait
check "first matched join finished" "$(tail -1 "$WORK/matched_1")" ok
check "second matched join finished" "$(tail -1 "$WORK/matched_2")" ok
check "both joins return the same halaqa" "$(head -1 "$WORK/matched_1")" "$(head -1 "$WORK/matched_2")"
check "one active matched membership" \
  "$(admin -c "SELECT count(*) FROM public.halaqa_members WHERE user_id = '$(uid 2)' AND kind = 'matched' AND left_at IS NULL")" 1

# ─── Finding 10: a join that is committing keeps the group alive ───────────────
# User 3 is the only member. User 4 joins by code and holds its transaction open until the leave is
# blocked; leaving must wait on the group row and then count the new member.
rm -f "$WORK"/*
CODE="$(as_user "$(uid 3)" "SELECT public.create_invite_halaqa('Race group')->>'invite_code';" |
  docker exec -i "$C" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA)"
GROUP="$(admin -c "SELECT id FROM public.halaqa_groups WHERE invite_code = '$CODE'")"
session join_hold "$(uid 4)" "BEGIN;
SELECT public.join_halaqa_by_code('$CODE')->>'member_count';
RESET ROLE;
DO \$\$ BEGIN
  FOR i IN 1 .. 200 LOOP
      PERFORM pg_stat_clear_snapshot();
    EXIT WHEN (SELECT count(*) FROM pg_stat_activity WHERE application_name = 'race_leave' AND wait_event_type = 'Lock') >= 1;
    PERFORM pg_sleep(0.05);
  END LOOP;
END \$\$;
COMMIT;"
admin -c "DO \$\$ BEGIN
  FOR i IN 1 .. 200 LOOP
      PERFORM pg_stat_clear_snapshot();
    EXIT WHEN EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'race_join_hold' AND query LIKE 'DO %');
    PERFORM pg_sleep(0.05);
  END LOOP;
END \$\$;" >/dev/null
session leave "$(uid 3)" "SELECT public.leave_halaqa('$GROUP');"
wait
check "join finished" "$(tail -1 "$WORK/join_hold")" ok
check "leave finished" "$(tail -1 "$WORK/leave")" ok
check "group not deleted under a new member" \
  "$(admin -c "SELECT deleted_at IS NULL FROM public.halaqa_groups WHERE id = '$GROUP'")" t
check "the joiner is an active member" \
  "$(admin -c "SELECT count(*) FROM public.halaqa_members WHERE group_id = '$GROUP' AND left_at IS NULL")" 1

# ─── Finding 11: two sends at once, with different dates, make one ────────────
# Users 4 (sender) and 5, 6 share the race group. The controller holds the sender's membership row;
# both sends wait on it, and the second then sees the first.
rm -f "$WORK"/*
for n in 5 6; do
  as_user "$(uid "$n")" "SELECT public.join_halaqa_by_code('$CODE');" |
    docker exec -i "$C" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA >/dev/null
done
YESTERDAY="$(admin -c "SELECT to_char((now() AT TIME ZONE 'UTC')::DATE - 1, 'YYYY-MM-DD')")"
TOMORROW="$(admin -c "SELECT to_char((now() AT TIME ZONE 'UTC')::DATE + 1, 'YYYY-MM-DD')")"
controller send "SELECT 1 FROM public.halaqa_members WHERE group_id = '$GROUP' AND user_id = '$(uid 4)' FOR UPDATE;" 2
wait_for_controller send
session send_1 "$(uid 4)" "SELECT public.send_halaqa_encouragement('$GROUP', '$(uid 5)', 'ease', NULL, '$YESTERDAY');"
session send_2 "$(uid 4)" "SELECT public.send_halaqa_encouragement('$GROUP', '$(uid 6)', 'dua', NULL, '$TOMORROW');"
wait
check "one send refused as already sent" \
  "$(cat "$WORK/send_1" "$WORK/send_2" | grep -c 'already_encouraged_today' || true)" 1
check "one encouragement stored" \
  "$(admin -c "SELECT count(*) FROM public.halaqa_encouragements WHERE group_id = '$GROUP' AND from_user = '$(uid 4)'")" 1

# ─── Second review, finding 11: a send and a leave by one member cannot deadlock ─────
# User 5 sends to user 6 while leaving the group. The controller holds user 5's membership row. The
# send takes the group row before that membership row, as leaving does, so the send waits on the
# membership row while holding the group and the leave waits on the group. A send that locked the
# membership row first and the group only at its insert would deadlock with the leave here.
rm -f "$WORK"/*
controller send_leave "SELECT 1 FROM public.halaqa_members WHERE group_id = '$GROUP' AND user_id = '$(uid 5)' FOR UPDATE;" 2
wait_for_controller send_leave
session sl_send "$(uid 5)" "SELECT public.send_halaqa_encouragement('$GROUP', '$(uid 6)', 'ease', NULL, '$TODAY');"
wait_for_waiters 1
session sl_leave "$(uid 5)" "SELECT public.leave_halaqa('$GROUP');"
wait
check "no deadlock" "$(cat "$WORK"/sl_send "$WORK"/sl_leave | grep -c 'deadlock detected' || true)" 0
check "send finished" "$(tail -1 "$WORK/sl_send")" ok
check "leave finished" "$(tail -1 "$WORK/sl_leave")" ok
check "the send is stored" \
  "$(admin -c "SELECT count(*) FROM public.halaqa_encouragements WHERE group_id = '$GROUP' AND from_user = '$(uid 5)'")" 1
check "the sender has left" \
  "$(admin -c "SELECT count(*) FROM public.halaqa_members WHERE group_id = '$GROUP' AND user_id = '$(uid 5)' AND left_at IS NULL")" 0

echo "learning_consistency_races.sh: all races passed"
