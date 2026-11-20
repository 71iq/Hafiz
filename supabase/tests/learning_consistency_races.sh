#!/usr/bin/env bash
# Two-session race tests for 20261113120000_learning_consistency.sql, as changed by
# 20261120120000_drop_halaqa.sql, which removed Halaqa and its races, and
# 20261120200000_remove_minor_setting.sql, which removed the under-18 setting and the races between
# minority writes and photos, likes, comments, private writes and Board joins.
# run-learning-consistency.sh calls this with its disposable, network-less container after
# learning_consistency.test.sql.
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

# Runs SQL as supabase_admin in its own background session, as an account deletion through GoTrue
# would. Same output file convention as session.
admin_session() {
  local name="$1" sql="$2"
  {
    if printf '%s\n' "$sql" | docker exec -i -e PGAPPNAME="race_$name" "$C" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qtA \
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
FROM generate_series(1, 25) AS i;
INSERT INTO public.profiles (id, username) SELECT ('00000000-0000-4000-8009-' || lpad(i::TEXT, 12, '0'))::UUID, 'race_user_' || i
FROM generate_series(1, 25) AS i;
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

# Counts the race outputs that report a deadlock.
deadlocks() { cat "$WORK"/* | grep -c 'deadlock detected' || true; }

# ─── Fourth review, finding 8: deleting an account while its own board read places it ──────────
# User 10 is on the board but not yet placed this week. The controller holds the week's placement
# lock, so the board read waits on it while holding user 10's profile_privacy row, and the deletion
# starts then. The read key-shared the profiles row before the privacy row, so the deletion waits on
# the profile until the read commits. A read that held only the privacy row would wait on the
# profiles row for its board_members foreign key while the deletion, having deleted the profile,
# waits on the privacy row it cascades to: a deadlock.
rm -f "$WORK"/*
WEEK3="$(admin -c "SELECT private.board_week((now() AT TIME ZONE 'UTC')::DATE, 3)")"
admin -c "INSERT INTO public.profile_privacy (user_id, board_joined, board_week_start, board_level_band, board_pace_band,
  board_utc_offset_minutes, board_enrolled_week) VALUES ('$(uid 10)', true, 3, 'hafiz', 'page_plus', 0, DATE '$WEEK3' - 7)" >/dev/null
controller del_read "SELECT pg_advisory_xact_lock(hashtextextended('hafiz:board:' || DATE '$WEEK3'::TEXT, 0));" 2
wait_for_controller del_read
session dr_read "$(uid 10)" "SELECT public.get_board('hafiz', 'page_plus', 0, '$TODAY', 3)->>'status';"
wait_for_waiters 1
admin_session dr_delete "DELETE FROM auth.users WHERE id = '$(uid 10)';"
wait
check "no deadlock between a board read and account deletion" "$(deadlocks)" 0
check "board read finished" "$(tail -1 "$WORK/dr_read")" ok
check "deletion finished" "$(tail -1 "$WORK/dr_delete")" ok
check "the account is gone with its placement" \
  "$(admin -c "SELECT count(*) FROM public.profiles WHERE id = '$(uid 10)'")/$(admin -c "SELECT count(*) FROM public.board_members WHERE user_id = '$(uid 10)'")" 0/0

# ─── Fourth review, finding 8: deleting an account while it joins the board ────────────────────
# User 13 left the board earlier, so joining updates their existing profile_privacy row and then
# places them. The controller holds one of user 13's user_settings rows, which the deletion reaches
# after deleting the profile and before profile_privacy, so the deletion waits there holding the
# profile while the join starts. The join locks the profiles row before the privacy row, so it waits
# for the deletion and then finds the account gone. A join that updated the privacy row first and
# reached the profile only at placement would hold the row the deletion cascades to next.
rm -f "$WORK"/*
admin -c "INSERT INTO public.profile_privacy (user_id) VALUES ('$(uid 13)');
  INSERT INTO public.user_settings (user_id, key, value) VALUES ('$(uid 13)', 'race', '1');" >/dev/null
controller del_join "SELECT 1 FROM public.user_settings WHERE user_id = '$(uid 13)' FOR UPDATE;" 2
wait_for_controller del_join
admin_session dj_delete "DELETE FROM auth.users WHERE id = '$(uid 13)';"
wait_for_waiters 1
session dj_join "$(uid 13)" "SELECT public.join_board(NULL, 'hafiz', 'page_plus', 0, '$TODAY', 3)->>'status';"
wait
check "no deadlock between joining the board and account deletion" "$(deadlocks)" 0
check "deletion finished" "$(tail -1 "$WORK/dj_delete")" ok
check "the join finished or found the account gone" \
  "$(if [ "$(tail -1 "$WORK/dj_join")" = ok ] || grep -q 'violates foreign key constraint' "$WORK/dj_join"; then echo yes; else echo no; fi)" yes
check "the account is gone with its board rows" \
  "$(admin -c "SELECT count(*) FROM public.profile_privacy WHERE user_id = '$(uid 13)'")/$(admin -c "SELECT count(*) FROM public.board_members WHERE user_id = '$(uid 13)'")" 0/0

# ─── Fourth review, finding 8: deleting an account while another reader's pass places it ───────
# User 11 is already placed this week, so their board read goes straight to the weekly pass, which
# places user 12 from their stored bands. The controller holds the week's placement lock, so the pass
# waits on it while holding user 12's profile_privacy row, and user 12's deletion starts then. The
# pass key-shared user 12's profiles row before the privacy row, so the deletion waits until the pass
# commits. A pass that held only the privacy row would deadlock as the board read above would.
rm -f "$WORK"/*
admin >/dev/null <<SQL
WITH cohort AS (
  INSERT INTO public.board_cohorts (week_start, level_band, pace_band, utc_offset_band)
  VALUES (DATE '$WEEK3', 'hafiz', 'page_plus', 0) RETURNING id
)
INSERT INTO public.board_members (cohort_id, user_id, week_start) SELECT id, '$(uid 11)', DATE '$WEEK3' FROM cohort;
INSERT INTO public.habit_days (user_id, local_date, earned_status, minimum_met, tz, created_at, updated_at)
VALUES ('$(uid 12)', '$TODAY', 'done', true, 'UTC', now(), now());
INSERT INTO public.profile_privacy (user_id, board_joined, board_week_start, board_level_band, board_pace_band,
  board_utc_offset_minutes, board_enrolled_week) VALUES
  ('$(uid 11)', true, 3, 'hafiz', 'page_plus', 0, DATE '$WEEK3'),
  ('$(uid 12)', true, 3, 'hafiz', 'page_plus', 0, DATE '$WEEK3' - 7);
SQL
controller del_pass "SELECT pg_advisory_xact_lock(hashtextextended('hafiz:board:' || DATE '$WEEK3'::TEXT, 0));" 2
wait_for_controller del_pass
session dp_read "$(uid 11)" "SELECT public.get_board('hafiz', 'page_plus', 0, '$TODAY', 3)->>'status';"
wait_for_waiters 1
admin_session dp_delete "DELETE FROM auth.users WHERE id = '$(uid 12)';"
wait
check "no deadlock between the weekly pass and account deletion" "$(deadlocks)" 0
check "board read finished" "$(tail -1 "$WORK/dp_read")" ok
check "deletion finished" "$(tail -1 "$WORK/dp_delete")" ok
check "the deleted account left no placement" "$(admin -c "SELECT count(*) FROM public.board_members WHERE user_id = '$(uid 12)'")" 0
check "the reader is still placed" \
  "$(admin -c "SELECT count(*) FROM public.board_members WHERE user_id = '$(uid 11)' AND left_at IS NULL")" 1

# Reflection counts compared with a full recount of every row, as "stored/counted" pairs for likes and
# comments.
recount() {
  admin -c "SELECT r.likes_count || '/' || (SELECT count(*) FROM public.reflection_likes AS l WHERE l.reflection_id = r.id)
    || ' ' || r.comments_count || '/' || (SELECT count(*) FROM public.reflection_comments AS c WHERE c.reflection_id = r.id)
    FROM public.reflections AS r WHERE r.id = '$1'"
}

# ─── Fifth review, finding 3: deleting an account while it deletes its own comment ─────────────
# User 23 comments on user 22's reflection. The controller holds one of user 23's user_settings rows,
# which the account deletion reaches after it has locked the profile and, in its BEFORE DELETE
# trigger, the reflection and the comment. The comment deletion starts then and waits on the profile.
# A comment deletion that locked the reflection or the comment before the profile would deadlock with
# the account deletion.
rm -f "$WORK"/*
admin -c "INSERT INTO public.reflections (user_id, surah, ayah_start, ayah_end, juz_start, juz_end, content)
  VALUES ('$(uid 22)', 2, 2, 2, 1, 1, 'A race reflection for deletions')" >/dev/null
DREFLECTION="$(admin -c "SELECT id FROM public.reflections WHERE content = 'A race reflection for deletions'")"
OCOMMENT="$(as_user "$(uid 23)" "SELECT (public.add_reflection_comment('$(uid 23)', '$DREFLECTION', 'A race comment by a deleted account')).id;" |
  docker exec -i "$C" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA)"
admin -c "INSERT INTO public.user_settings (user_id, key, value) VALUES ('$(uid 23)', 'race', '1')" >/dev/null
controller del_comment "SELECT 1 FROM public.user_settings WHERE user_id = '$(uid 23)' FOR UPDATE;" 2
wait_for_controller del_comment
admin_session dc_delete "DELETE FROM auth.users WHERE id = '$(uid 23)';"
wait_for_waiters 1
session dc_comment "$(uid 23)" "SELECT public.delete_reflection_comment('$(uid 23)', '$OCOMMENT');"
wait
check "no deadlock between account deletion and deleting its comment" "$(deadlocks)" 0
check "account deletion finished" "$(tail -1 "$WORK/dc_delete")" ok
check "the comment deletion finished or found the account gone" \
  "$(if [ "$(tail -1 "$WORK/dc_comment")" = ok ] || grep -q not_authenticated "$WORK/dc_comment"; then echo yes; else echo no; fi)" yes
check "the comment is gone" "$(admin -c "SELECT count(*) FROM public.reflection_comments WHERE id = '$OCOMMENT'")" 0
check "the counts match a recount" "$(recount "$DREFLECTION")" "0/0 0/0"

# ─── Card merge: two devices upload one card at once ─────────────────────────────
# Device B graded the card Again at 09:03; device A suspended its 08:00 copy at 09:05. The controller
# holds the card row, so both uploads (INSERT ... ON CONFLICT DO UPDATE, as PostgREST sends them) wait
# and then apply one after the other in either order, each merging with the row the other committed.
rm -f "$WORK"/*
admin >/dev/null <<SQL
INSERT INTO auth.users (id, email) VALUES ('$(uid 26)', 'race26@example.invalid');
INSERT INTO public.profiles (id, username) VALUES ('$(uid 26)', 'race_user_26');
INSERT INTO public.study_cards (id, user_id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days,
  learning_steps, reps, lapses, state, last_review, created_at, updated_at)
VALUES ('5:1', '$(uid 26)', 'default', '2026-11-20T08:00:00Z', 10, 5, 3, 7, 0, 3, 0, 2, '2026-11-13T08:00:00Z',
  '2026-11-01T00:00:00Z', '2026-11-13T09:00:00Z');
SQL
# Upload SQL for card 5:1: schedule as "due, stability, difficulty, elapsed, scheduled, reps, lapses, state,
# last_review", then suspended_at and updated_at.
card_upload() {
  printf "INSERT INTO public.study_cards (id, user_id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days,
  learning_steps, reps, lapses, state, last_review, created_at, suspended_at, updated_at, synced_at)
VALUES ('5:1', '%s', 'default', %s, 0, %s, '2026-11-01T00:00:00Z', %s, clock_timestamp())
ON CONFLICT (user_id, id) DO UPDATE SET due = EXCLUDED.due, stability = EXCLUDED.stability,
  difficulty = EXCLUDED.difficulty, elapsed_days = EXCLUDED.elapsed_days, scheduled_days = EXCLUDED.scheduled_days,
  learning_steps = EXCLUDED.learning_steps, reps = EXCLUDED.reps, lapses = EXCLUDED.lapses, state = EXCLUDED.state,
  last_review = EXCLUDED.last_review, suspended_at = EXCLUDED.suspended_at, created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at, synced_at = EXCLUDED.synced_at;" "$(uid 26)" "$1" "$2" "$3"
}
SCHEDULE_A="'2026-11-20T08:00:00Z', 10, 5, 3, 7"
SCHEDULE_A_TAIL="3, 0, 2, '2026-11-13T08:00:00Z'"
SCHEDULE_B="'2026-11-13T09:13:00Z', 2, 7, 0, 0"
SCHEDULE_B_TAIL="4, 1, 3, '2026-11-13T09:03:00Z'"
controller card "SELECT 1 FROM public.study_cards WHERE user_id = '$(uid 26)' AND id = '5:1' FOR UPDATE;" 2
wait_for_controller card
session card_a "$(uid 26)" "$(card_upload "${SCHEDULE_A}" "${SCHEDULE_A_TAIL}" "'2026-11-13T09:05:00Z', '2026-11-13T09:05:00Z'")"
session card_b "$(uid 26)" "$(card_upload "${SCHEDULE_B}" "${SCHEDULE_B_TAIL}" "NULL, '2026-11-13T09:03:00Z'")"
wait
check "device A's upload finished" "$(tail -1 "$WORK/card_a")" ok
check "device B's upload finished" "$(tail -1 "$WORK/card_b")" ok
check "the card has B's review and A's suspension" \
  "$(admin -c "SELECT concat_ws('/', state, reps, lapses, to_char(last_review AT TIME ZONE 'UTC', 'HH24:MI'),
    to_char(suspended_at AT TIME ZONE 'UTC', 'HH24:MI'), to_char(updated_at AT TIME ZONE 'UTC', 'HH24:MI'))
    FROM public.study_cards WHERE user_id = '$(uid 26)' AND id = '5:1'")" "3/4/1/09:03/09:05/09:05"

echo "learning_consistency_races.sh: all races passed"
