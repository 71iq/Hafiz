#!/usr/bin/env bash
set -euo pipefail
C="$1"
WORK="$(mktemp -d)"
trap 'wait 2>/dev/null; rm -rf "$WORK"' EXIT

admin() { docker exec -i "$C" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qtA "$@"; }

as_user() {
  printf "\\o /dev/null\nSELECT set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\"}', false);\n\\o\nSET ROLE authenticated;\n%s\n" "$1" "$2"
}

as_anon() {
  printf "SET ROLE anon;\n%s\n" "$1" | docker exec -i "$C" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA
}

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

wait_for_hold() {
  admin -c "DO \$\$ BEGIN
    FOR i IN 1 .. 200 LOOP
      PERFORM pg_stat_clear_snapshot();
      EXIT WHEN EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'race_$1' AND query LIKE 'DO %');
      PERFORM pg_sleep(0.05);
    END LOOP;
  END \$\$;" >/dev/null
}

rm -f "$WORK"/*
session photo_hold "$(uid 7)" "BEGIN;
UPDATE public.profiles SET avatar_url = 'https://example.invalid/race7.png' WHERE id = '$(uid 7)';
RESET ROLE;
DO \$\$ BEGIN
  FOR i IN 1 .. 200 LOOP
    PERFORM pg_stat_clear_snapshot();
    EXIT WHEN (SELECT count(*) FROM pg_stat_activity WHERE application_name = 'race_photo_minor' AND wait_event_type = 'Lock') >= 1;
    PERFORM pg_sleep(0.05);
  END LOOP;
END \$\$;
COMMIT;"
wait_for_hold photo_hold
session photo_minor "$(uid 7)" "SELECT public.set_profile_privacy(false, false, true, false)->>'is_minor';"
wait
check "photo update finished" "$(tail -1 "$WORK/photo_hold")" ok
check "minority write finished" "$(tail -1 "$WORK/photo_minor")" ok
check "recorded as a minor" "$(admin -c "SELECT is_minor FROM public.profile_privacy WHERE user_id = '$(uid 7)'")" t
check "the minor has no photo" "$(admin -c "SELECT avatar_url IS NULL FROM public.profiles WHERE id = '$(uid 7)'")" t

rm -f "$WORK"/*
controller minor_join "SELECT pg_advisory_xact_lock(hashtextextended('hafiz:halaqa-user:$(uid 8)', 0));" 2
wait_for_controller minor_join
session mj_join "$(uid 8)" "SELECT public.join_matched_halaqa('juz_amma', 'light', 180)->>'id';"
wait_for_waiters 1
session mj_minor "$(uid 8)" "SELECT public.set_profile_privacy(false, false, true, false)->>'is_minor';"
wait
check "minority write finished" "$(tail -1 "$WORK/mj_minor")" ok
check "the join committed first or was refused as a minor" \
  "$(if [ "$(tail -1 "$WORK/mj_join")" = ok ] || grep -q minor_not_allowed "$WORK/mj_join"; then echo yes; else echo no; fi)" yes
check "recorded as a minor" "$(admin -c "SELECT is_minor FROM public.profile_privacy WHERE user_id = '$(uid 8)'")" t
check "no matched membership" \
  "$(admin -c "SELECT count(*) FROM public.halaqa_members WHERE user_id = '$(uid 8)' AND kind = 'matched' AND left_at IS NULL")" 0

rm -f "$WORK"/*
admin -c "INSERT INTO public.profile_privacy (user_id) VALUES ('$(uid 9)')" >/dev/null
controller minor_first "SELECT 1 FROM public.profile_privacy WHERE user_id = '$(uid 9)' FOR UPDATE;" 2
wait_for_controller minor_first
session mf_minor "$(uid 9)" "SELECT public.set_profile_privacy(false, false, true, false)->>'is_minor';"
wait_for_waiters 1
session mf_join "$(uid 9)" "SELECT public.join_matched_halaqa('juz_amma', 'light', 180)->>'id';"
wait
check "minority write finished" "$(tail -1 "$WORK/mf_minor")" ok
check "the join is refused" "$(grep -c minor_not_allowed "$WORK/mf_join" || true)" 1
check "no matched membership" \
  "$(admin -c "SELECT count(*) FROM public.halaqa_members WHERE user_id = '$(uid 9)' AND kind = 'matched' AND left_at IS NULL")" 0

deadlocks() { cat "$WORK"/* | grep -c 'deadlock detected' || true; }

rm -f "$WORK"/*
admin -c "INSERT INTO public.reflections (user_id, surah, ayah_start, ayah_end, juz_start, juz_end, content)
  VALUES ('$(uid 19)', 2, 1, 1, 1, 1, 'A race reflection by an adult')" >/dev/null
REFLECTION="$(admin -c "SELECT id FROM public.reflections WHERE user_id = '$(uid 19)'")"
session like_hold "$(uid 18)" "BEGIN;
SELECT public.set_reflection_like('$(uid 18)', '$REFLECTION', true);
RESET ROLE;
DO \$\$ BEGIN
  FOR i IN 1 .. 200 LOOP
    PERFORM pg_stat_clear_snapshot();
    EXIT WHEN (SELECT count(*) FROM pg_stat_activity WHERE application_name = 'race_like_minor' AND wait_event_type = 'Lock') >= 1;
    PERFORM pg_sleep(0.05);
  END LOOP;
END \$\$;
COMMIT;"
wait_for_hold like_hold
session like_minor "$(uid 18)" "SELECT public.set_profile_privacy(false, false, true, false)->>'is_minor';"
wait
check "like finished" "$(tail -1 "$WORK/like_hold")" ok
check "minority write finished" "$(tail -1 "$WORK/like_minor")" ok
check "the like is stored" "$(admin -c "SELECT count(*) FROM public.reflection_likes WHERE user_id = '$(uid 18)'")" 1
check "the minor's like is not counted" "$(admin -c "SELECT likes_count FROM public.reflections WHERE id = '$REFLECTION'")" 0

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

rm -f "$WORK"/*
admin -c "INSERT INTO public.profile_privacy (user_id) VALUES ('$(uid 13)');
  INSERT INTO public.user_settings (user_id, key, value) VALUES ('$(uid 13)', 'race', '1');" >/dev/null
controller del_join "SELECT 1 FROM public.user_settings WHERE user_id = '$(uid 13)' FOR UPDATE;" 2
wait_for_controller del_join
admin_session dj_delete "DELETE FROM auth.users WHERE id = '$(uid 13)';"
wait_for_waiters 1
session dj_join "$(uid 13)" "SELECT public.join_board(NULL, false, false, 'hafiz', 'page_plus', 0, '$TODAY', 3)->>'status';"
wait
check "no deadlock between joining the board and account deletion" "$(deadlocks)" 0
check "deletion finished" "$(tail -1 "$WORK/dj_delete")" ok
check "the join finished or found the account gone" \
  "$(if [ "$(tail -1 "$WORK/dj_join")" = ok ] || grep -q 'violates foreign key constraint' "$WORK/dj_join"; then echo yes; else echo no; fi)" yes
check "the account is gone with its board rows" \
  "$(admin -c "SELECT count(*) FROM public.profile_privacy WHERE user_id = '$(uid 13)'")/$(admin -c "SELECT count(*) FROM public.board_members WHERE user_id = '$(uid 13)'")" 0/0

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

rm -f "$WORK"/*
DCODE="$(as_user "$(uid 14)" "SELECT public.create_invite_halaqa('Deletion race')->>'invite_code';" |
  docker exec -i "$C" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA)"
DGROUP="$(admin -c "SELECT id FROM public.halaqa_groups WHERE invite_code = '$DCODE'")"
as_user "$(uid 15)" "SELECT public.join_halaqa_by_code('$DCODE');" |
  docker exec -i "$C" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA >/dev/null
controller del_send "LOCK TABLE public.halaqa_encouragements IN SHARE MODE;" 2
wait_for_controller del_send
session ds_send "$(uid 15)" "SELECT public.send_halaqa_encouragement('$DGROUP', '$(uid 14)', 'ease', NULL, '$TODAY');"
wait_for_waiters 1
admin_session ds_delete "DELETE FROM auth.users WHERE id = '$(uid 15)';"
wait
check "no deadlock between a send and the sender's deletion" "$(deadlocks)" 0
check "send finished" "$(tail -1 "$WORK/ds_send")" ok
check "deletion finished" "$(tail -1 "$WORK/ds_delete")" ok
check "the sender's membership and encouragement went with the account" \
  "$(admin -c "SELECT count(*) FROM public.halaqa_members WHERE user_id = '$(uid 15)'")/$(admin -c "SELECT count(*) FROM public.halaqa_encouragements WHERE from_user = '$(uid 15)'")" 0/0

rm -f "$WORK"/*
RCODE="$(as_user "$(uid 16)" "SELECT public.create_invite_halaqa('Recipient race')->>'invite_code';" |
  docker exec -i "$C" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA)"
RGROUP="$(admin -c "SELECT id FROM public.halaqa_groups WHERE invite_code = '$RCODE'")"
as_user "$(uid 17)" "SELECT public.join_halaqa_by_code('$RCODE');" |
  docker exec -i "$C" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA >/dev/null
controller del_recipient "LOCK TABLE public.halaqa_encouragements IN SHARE MODE;" 2
wait_for_controller del_recipient
session dr_send "$(uid 17)" "SELECT public.send_halaqa_encouragement('$RGROUP', '$(uid 16)', 'ease', NULL, '$TODAY');"
wait_for_waiters 1
admin_session dr_delete "DELETE FROM auth.users WHERE id = '$(uid 16)';"
wait
check "no deadlock between a send and the recipient's deletion" "$(deadlocks)" 0
check "send finished" "$(tail -1 "$WORK/dr_send")" ok
check "deletion finished" "$(tail -1 "$WORK/dr_delete")" ok
check "the group stays for the sender without a creator" \
  "$(admin -c "SELECT (created_by IS NULL)::TEXT || '/' || (deleted_at IS NULL)::TEXT FROM public.halaqa_groups WHERE id = '$RGROUP'")" true/true
check "the encouragement went with the recipient" \
  "$(admin -c "SELECT count(*) FROM public.halaqa_encouragements WHERE to_user = '$(uid 16)'")" 0

rm -f "$WORK"/*
admin -c "INSERT INTO public.profile_privacy (user_id, is_minor) VALUES ('$(uid 20)', true)" >/dev/null
session withdraw_hold "$(uid 20)" "BEGIN;
SELECT public.set_profile_privacy(false, false, false, true)->>'is_minor';
RESET ROLE;
DO \$\$ BEGIN
  FOR i IN 1 .. 200 LOOP
    PERFORM pg_stat_clear_snapshot();
    EXIT WHEN (SELECT count(*) FROM pg_stat_activity WHERE application_name = 'race_promised' AND wait_event_type = 'Lock') >= 1;
    PERFORM pg_sleep(0.05);
  END LOOP;
END \$\$;
COMMIT;"
wait_for_hold withdraw_hold
session promised "$(uid 20)" "SELECT public.create_reflection('$(uid 20)', 2, 1, 1, 1, 1, 'Promised private during a withdrawal', true);"
wait
check "withdrawal finished" "$(tail -1 "$WORK/withdraw_hold")" ok
check "the promised-private write is refused" "$(grep -c privacy_changed "$WORK/promised" || true)" 1
check "nothing was published" "$(admin -c "SELECT count(*) FROM public.reflections WHERE user_id = '$(uid 20)'")" 0

recount() {
  admin -c "SELECT r.likes_count || '/' || (SELECT count(*) FROM public.reflection_likes AS l
      WHERE l.reflection_id = r.id AND NOT l.is_private AND NOT private.is_minor(l.user_id))
    || ' ' || r.comments_count || '/' || (SELECT count(*) FROM public.reflection_comments AS c
      WHERE c.reflection_id = r.id AND NOT c.is_private AND NOT private.is_minor(c.user_id))
    FROM public.reflections AS r WHERE r.id = '$1'"
}

rm -f "$WORK"/*
admin -c "INSERT INTO public.reflections (user_id, surah, ayah_start, ayah_end, juz_start, juz_end, content)
  VALUES ('$(uid 22)', 2, 2, 2, 1, 1, 'A race reflection for deletions')" >/dev/null
DREFLECTION="$(admin -c "SELECT id FROM public.reflections WHERE content = 'A race reflection for deletions'")"
DCOMMENT="$(as_user "$(uid 21)" "SELECT (public.add_reflection_comment('$(uid 21)', '$DREFLECTION', 'A self-liked race comment', false)).id;" |
  docker exec -i "$C" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA)"
as_user "$(uid 21)" "SELECT public.set_reflection_comment_like('$(uid 21)', '$DCOMMENT', true);" |
  docker exec -i "$C" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA >/dev/null
controller minor_delete "SELECT 1 FROM public.reflections WHERE id = '$DREFLECTION' FOR NO KEY UPDATE;" 2
wait_for_controller minor_delete
session md_minor "$(uid 21)" "SELECT public.set_profile_privacy(false, false, true, false)->>'is_minor';"
wait_for_waiters 1
session md_delete "$(uid 21)" "SELECT public.delete_reflection_comment('$(uid 21)', '$DCOMMENT');"
wait
check "no deadlock between a minority write and deleting a self-liked comment" "$(deadlocks)" 0
check "minority write finished" "$(tail -1 "$WORK/md_minor")" ok
check "deletion finished" "$(tail -1 "$WORK/md_delete")" ok
check "the comment and its like are gone" \
  "$(admin -c "SELECT count(*) FROM public.reflection_comments WHERE id = '$DCOMMENT'")/$(admin -c "SELECT count(*) FROM public.reflection_comment_likes WHERE comment_id = '$DCOMMENT'")" 0/0
check "the counts match a recount" "$(recount "$DREFLECTION")" "0/0 0/0"

rm -f "$WORK"/*
OCOMMENT="$(as_user "$(uid 23)" "SELECT (public.add_reflection_comment('$(uid 23)', '$DREFLECTION', 'A race comment by a deleted account', false)).id;" |
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

rm -f "$WORK"/*
admin -c "INSERT INTO public.profile_privacy (user_id, is_minor) VALUES ('$(uid 24)', true)" >/dev/null
session private_hold "$(uid 24)" "BEGIN;
SELECT public.set_reflection_like('$(uid 24)', '$DREFLECTION', true);
SELECT (public.add_reflection_comment('$(uid 24)', '$DREFLECTION', 'A private race comment', true)).id;
RESET ROLE;
DO \$\$ BEGIN
  FOR i IN 1 .. 200 LOOP
    PERFORM pg_stat_clear_snapshot();
    EXIT WHEN (SELECT count(*) FROM pg_stat_activity WHERE application_name = 'race_private_withdraw' AND wait_event_type = 'Lock') >= 1;
    PERFORM pg_sleep(0.05);
  END LOOP;
END \$\$;
COMMIT;"
wait_for_hold private_hold
session private_withdraw "$(uid 24)" "SELECT public.set_profile_privacy(false, false, false, true)->>'is_minor';"
wait
check "private writes finished" "$(tail -1 "$WORK/private_hold")" ok
check "withdrawal finished" "$(tail -1 "$WORK/private_withdraw")" ok
check "the withdrawal leaves the private like and comment out of the counts" \
  "$(admin -c "SELECT likes_count || '/' || comments_count FROM public.reflections WHERE id = '$DREFLECTION'")" 0/0
check "anon reads neither" \
  "$(as_anon "SELECT (SELECT count(*) FROM public.reflection_likes WHERE user_id = '$(uid 24)') + (SELECT count(*) FROM public.reflection_comments WHERE user_id = '$(uid 24)');")" 0
check "both are stored private" \
  "$(admin -c "SELECT (SELECT bool_and(is_private) FROM public.reflection_likes WHERE user_id = '$(uid 24)')::TEXT || '/' || (SELECT bool_and(is_private) FROM public.reflection_comments WHERE user_id = '$(uid 24)')::TEXT")" true/true
check "the counts match a recount" "$(recount "$DREFLECTION")" "0/0 0/0"

rm -f "$WORK"/*
session minor_hold "$(uid 25)" "BEGIN;
SELECT public.set_profile_privacy(false, false, true, false)->>'is_minor';
RESET ROLE;
DO \$\$ BEGIN
  FOR i IN 1 .. 200 LOOP
    PERFORM pg_stat_clear_snapshot();
    EXIT WHEN (SELECT count(*) FROM pg_stat_activity WHERE application_name = 'race_stale_join' AND wait_event_type = 'Lock') >= 1;
    PERFORM pg_sleep(0.05);
  END LOOP;
END \$\$;
COMMIT;"
wait_for_hold minor_hold
session stale_join "$(uid 25)" "SELECT public.join_board(NULL, false, false, 'juz_amma', 'light', 180, '$TODAY', 1)->>'status';"
wait
check "minority write finished" "$(tail -1 "$WORK/minor_hold")" ok
check "the stale join is refused" "$(grep -c privacy_changed "$WORK/stale_join" || true)" 1
check "minority stays recorded and the Board is not joined" \
  "$(admin -c "SELECT is_minor::TEXT || '/' || board_joined::TEXT FROM public.profile_privacy WHERE user_id = '$(uid 25)'")" true/false

rm -f "$WORK"/*
admin >/dev/null <<SQL
INSERT INTO auth.users (id, email) VALUES ('$(uid 26)', 'race26@example.invalid');
INSERT INTO public.profiles (id, username) VALUES ('$(uid 26)', 'race_user_26');
INSERT INTO public.study_cards (id, user_id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days,
  learning_steps, reps, lapses, state, last_review, created_at, updated_at)
VALUES ('5:1', '$(uid 26)', 'default', '2026-11-20T08:00:00Z', 10, 5, 3, 7, 0, 3, 0, 2, '2026-11-13T08:00:00Z',
  '2026-11-01T00:00:00Z', '2026-11-13T09:00:00Z');
SQL
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

rm -f "$WORK"/*
admin >/dev/null <<SQL
INSERT INTO auth.users (id, email) VALUES ('$(uid 30)', 'race30@example.invalid'), ('$(uid 31)', 'race31@example.invalid');
INSERT INTO public.profiles (id, username) VALUES ('$(uid 30)', 'race_user_30'), ('$(uid 31)', 'race_user_31');
SQL
SABAQ_CODE="$(as_user "$(uid 30)" "SELECT public.create_invite_halaqa('Sabaq race', true)->>'invite_code';" |
  docker exec -i "$C" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA)"
SABAQ_GROUP="$(admin -c "SELECT id FROM public.halaqa_groups WHERE invite_code = '$SABAQ_CODE'")"
as_user "$(uid 31)" "SELECT public.join_halaqa_by_code('$SABAQ_CODE');
SELECT public.set_halaqa_sharing('$SABAQ_GROUP', true, true, true, false);" |
  docker exec -i "$C" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA >/dev/null
session sabaq_withdraw "$(uid 31)" "BEGIN;
SELECT public.set_halaqa_sharing('$SABAQ_GROUP', true, true, false, false) IS NOT NULL;
RESET ROLE;
DO \$\$ BEGIN
  FOR i IN 1 .. 200 LOOP
    PERFORM pg_stat_clear_snapshot();
    EXIT WHEN (SELECT count(*) FROM pg_stat_activity WHERE application_name = 'race_sabaq_assign' AND wait_event_type = 'Lock') >= 1;
    PERFORM pg_sleep(0.05);
  END LOOP;
END \$\$;
COMMIT;"
wait_for_hold sabaq_withdraw
session sabaq_assign "$(uid 30)" "SELECT public.set_halaqa_sabaq_assignment('$SABAQ_GROUP', '$(uid 31)', 582, 3, 9) IS NOT NULL;"
wait
check "withdrawal finished" "$(tail -1 "$WORK/sabaq_withdraw")" ok
check "the assignment is refused" "$(grep -c plan_not_shared "$WORK/sabaq_assign" || true)" 1
check "no assignment stored" \
  "$(admin -c "SELECT count(*) FROM public.halaqa_sabaq_assignments WHERE learner_id = '$(uid 31)'")" 0

rm -f "$WORK"/*
as_user "$(uid 31)" "SELECT public.set_halaqa_sharing('$SABAQ_GROUP', true, true, true, false);" |
  docker exec -i "$C" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA >/dev/null
controller sabaq_leave "SELECT 1 FROM public.halaqa_members WHERE group_id = '$SABAQ_GROUP' AND user_id = '$(uid 31)' FOR UPDATE;" 2
wait_for_controller sabaq_leave
session sq_assign "$(uid 30)" "SELECT public.set_halaqa_sabaq_assignment('$SABAQ_GROUP', '$(uid 31)', 582, 3, 9) IS NOT NULL;"
wait_for_waiters 1
session sq_leave "$(uid 31)" "SELECT public.leave_halaqa('$SABAQ_GROUP');"
wait
check "no deadlock" "$(cat "$WORK"/sq_assign "$WORK"/sq_leave | grep -c 'deadlock detected' || true)" 0
check "assignment finished" "$(tail -1 "$WORK/sq_assign")" ok
check "leave finished" "$(tail -1 "$WORK/sq_leave")" ok
check "leaving deleted the assignment" \
  "$(admin -c "SELECT count(*) FROM public.halaqa_sabaq_assignments WHERE learner_id = '$(uid 31)'")" 0

rm -f "$WORK"/*
admin >/dev/null <<SQL
INSERT INTO auth.users (id, email) VALUES ('$(uid 32)', 'race32@example.invalid');
INSERT INTO public.profiles (id, username) VALUES ('$(uid 32)', 'race_user_32');
SQL
as_user "$(uid 32)" "SELECT public.join_halaqa_by_code('$SABAQ_CODE');
SELECT public.set_halaqa_sharing('$SABAQ_GROUP', true, true, true, false);" |
  docker exec -i "$C" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA >/dev/null
controller sabaq_delete "SELECT 1 FROM public.halaqa_members WHERE group_id = '$SABAQ_GROUP' AND user_id = '$(uid 32)' FOR UPDATE;" 2
wait_for_controller sabaq_delete
session sd_assign "$(uid 30)" "SELECT public.set_halaqa_sabaq_assignment('$SABAQ_GROUP', '$(uid 32)', 582, 3, 9) IS NOT NULL;"
wait_for_waiters 1
admin_session sd_delete "DELETE FROM auth.users WHERE id = '$(uid 32)';"
wait
check "no deadlock between an assignment and account deletion" "$(deadlocks)" 0
check "assignment finished" "$(tail -1 "$WORK/sd_assign")" ok
check "deletion finished" "$(tail -1 "$WORK/sd_delete")" ok
check "the account is gone with its assignment" \
  "$(admin -c "SELECT count(*) FROM public.profiles WHERE id = '$(uid 32)'")/$(admin -c "SELECT count(*) FROM public.halaqa_sabaq_assignments WHERE learner_id = '$(uid 32)'")" 0/0

echo "learning_consistency_races.sh: all races passed"
