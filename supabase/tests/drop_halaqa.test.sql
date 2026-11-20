-- Checks 20261120120000_drop_halaqa.sql against a database that still holds Halaqa rows, as production
-- does. run-learning-consistency.sh runs this with -v phase=before after 20261113120000, applies the drop
-- migration twice, and runs this again with -v phase=after. Synthetic users only, deleted at the end so
-- learning_consistency.test.sql starts from the same state as before. Any failed assertion stops psql.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset pager off

SELECT :'phase' = 'before' AS before_drop \gset

\if :before_drop
CREATE SCHEMA hz_drop;
GRANT USAGE ON SCHEMA hz_drop TO authenticated;

CREATE FUNCTION hz_drop.login(uid UUID) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::TEXT, false);
$$;
CREATE FUNCTION hz_drop.eq(label TEXT, actual ANYELEMENT, expected ANYELEMENT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'drop_halaqa %: expected %, got %', label, expected, actual;
  END IF;
END;
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hz_drop TO authenticated;

-- Row counts of the tables that keep their data, compared after the drop.
CREATE FUNCTION hz_drop.kept_counts() RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT concat_ws(' ',
    'profiles=' || (SELECT count(*) FROM public.profiles),
    'profile_privacy=' || (SELECT count(*) FROM public.profile_privacy),
    'habit_days=' || (SELECT count(*) FROM public.habit_days),
    'achievement_unlocks=' || (SELECT count(*) FROM public.achievement_unlocks),
    'reflections=' || (SELECT count(*) FROM public.reflections),
    'study_cards=' || (SELECT count(*) FROM public.study_cards));
$$;
CREATE TABLE hz_drop.saved (counts TEXT);

-- 1 and 2 are adults, 3 stated they are a minor. All three share an invite halaqa where 2 teaches,
-- and 1 is also in a matched halaqa. 1 shares juz completions there (the default) but not on their
-- profile.
INSERT INTO auth.users (id, email) SELECT ('00000000-0000-4000-8090-' || lpad(i::TEXT, 12, '0'))::UUID,
  'drop' || i || '@example.invalid' FROM generate_series(1, 3) AS i;
INSERT INTO public.profiles (id, username, display_name, avatar_url)
SELECT ('00000000-0000-4000-8090-' || lpad(i::TEXT, 12, '0'))::UUID, 'drop_user_' || i, 'Drop ' || i,
  'https://example.invalid/drop' || i || '.png' FROM generate_series(1, 3) AS i;
INSERT INTO public.profile_privacy (user_id, is_minor) VALUES
  ('00000000-0000-4000-8090-000000000001', false),
  ('00000000-0000-4000-8090-000000000003', true);
INSERT INTO public.habit_days (user_id, local_date, earned_status, minimum_met, tz, created_at, updated_at)
VALUES ('00000000-0000-4000-8090-000000000001', to_char((now() AT TIME ZONE 'UTC')::DATE, 'YYYY-MM-DD'), 'done', true,
  'UTC', now(), now());
INSERT INTO public.achievement_unlocks (user_id, achievement_id, unlocked_at)
VALUES ('00000000-0000-4000-8090-000000000001', 'juz_30_completed', now());
INSERT INTO public.reflections (user_id, surah, ayah_start, ayah_end, juz_start, juz_end, content)
VALUES ('00000000-0000-4000-8090-000000000001', 1, 1, 1, 1, 1, 'A reflection kept through the Halaqa drop');
INSERT INTO public.study_cards (id, user_id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days,
  learning_steps, created_at, updated_at)
VALUES ('1:1', '00000000-0000-4000-8090-000000000001', 'default', now(), 1, 5, 0, 0, 0, now(), now());

INSERT INTO public.halaqa_groups (id, kind, name, invite_code, created_by) VALUES
  ('00000000-0000-4000-8091-000000000001', 'invite', 'Drop family', 'DRPHLQ23', '00000000-0000-4000-8090-000000000002');
INSERT INTO public.halaqa_groups (id, kind, level_band, pace_band, utc_offset_band, created_by) VALUES
  ('00000000-0000-4000-8091-000000000002', 'matched', 'juz_amma', 'light', 1, '00000000-0000-4000-8090-000000000001');
INSERT INTO public.halaqa_members (group_id, kind, user_id, role, share_plan_with_teachers) VALUES
  ('00000000-0000-4000-8091-000000000001', 'invite', '00000000-0000-4000-8090-000000000001', 'member', true),
  ('00000000-0000-4000-8091-000000000001', 'invite', '00000000-0000-4000-8090-000000000002', 'teacher', false),
  ('00000000-0000-4000-8091-000000000001', 'invite', '00000000-0000-4000-8090-000000000003', 'member', false),
  ('00000000-0000-4000-8091-000000000002', 'matched', '00000000-0000-4000-8090-000000000001', 'member', false);
INSERT INTO public.halaqa_encouragements (group_id, from_user, to_user, template_id, local_date, sent_on)
VALUES ('00000000-0000-4000-8091-000000000001', '00000000-0000-4000-8090-000000000002',
  '00000000-0000-4000-8090-000000000001', 'ease', to_char(current_date, 'YYYY-MM-DD'), current_date);
INSERT INTO public.halaqa_sabaq_assignments (group_id, learner_id, teacher_id, page, from_line, to_line)
VALUES ('00000000-0000-4000-8091-000000000001', '00000000-0000-4000-8090-000000000001',
  '00000000-0000-4000-8090-000000000002', 582, 3, 9);
INSERT INTO public.review_partners (user_a, user_b)
VALUES ('00000000-0000-4000-8090-000000000001', '00000000-0000-4000-8090-000000000002');

INSERT INTO hz_drop.saved SELECT hz_drop.kept_counts();
GRANT SELECT ON hz_drop.saved TO authenticated;

-- Before the drop, the Halaqa branches are live: a co-member reads shared juz completions and a
-- minor's summary. These are what the drop must turn off.
SELECT hz_drop.login('00000000-0000-4000-8090-000000000002');
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM hz_drop.eq('before: a co-member sees shared juz completions',
    public.get_profile_summary('00000000-0000-4000-8090-000000000001')->'juz_completed', '[30]'::JSONB);
  PERFORM hz_drop.eq('before: a co-member reads the juz badge', (
    SELECT count(*) FROM public.achievement_unlocks WHERE user_id = '00000000-0000-4000-8090-000000000001'
  ), 1::BIGINT);
  PERFORM hz_drop.eq('before: a co-member sees a minor''s summary',
    public.get_profile_summary('00000000-0000-4000-8090-000000000003') IS NOT NULL, true);
END $$;
RESET ROLE;

\else

DO $$
BEGIN
  PERFORM hz_drop.eq('halaqa_groups dropped', to_regclass('public.halaqa_groups'), NULL::regclass);
  PERFORM hz_drop.eq('halaqa_members dropped', to_regclass('public.halaqa_members'), NULL::regclass);
  PERFORM hz_drop.eq('halaqa_encouragements dropped', to_regclass('public.halaqa_encouragements'), NULL::regclass);
  PERFORM hz_drop.eq('halaqa_sabaq_assignments dropped', to_regclass('public.halaqa_sabaq_assignments'), NULL::regclass);
  PERFORM hz_drop.eq('review_partners dropped', to_regclass('public.review_partners'), NULL::regclass);
  PERFORM hz_drop.eq('every other row kept', hz_drop.kept_counts(), (SELECT counts FROM hz_drop.saved));
  PERFORM hz_drop.eq('the minor is still a minor', (
    SELECT is_minor FROM public.profile_privacy WHERE user_id = '00000000-0000-4000-8090-000000000003'
  ), true);
END $$;

SELECT hz_drop.login('00000000-0000-4000-8090-000000000002');
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM hz_drop.eq('after: a former co-member sees nothing private',
    public.get_profile_summary('00000000-0000-4000-8090-000000000001'), '{"streak": null, "juz_completed": null}'::JSONB);
  PERFORM hz_drop.eq('after: a former co-member reads no badge', (
    SELECT count(*) FROM public.achievement_unlocks WHERE user_id = '00000000-0000-4000-8090-000000000001'
  ), 0::BIGINT);
  PERFORM hz_drop.eq('after: a former co-member gets no summary for a minor',
    public.get_profile_summary('00000000-0000-4000-8090-000000000003'), NULL::JSONB);
END $$;
RESET ROLE;

-- The owner still sees everything, and recording minority runs without Halaqa: it clears the photo.
SELECT hz_drop.login('00000000-0000-4000-8090-000000000001');
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM hz_drop.eq('after: the owner sees their juz completions',
    public.get_profile_summary(auth.uid())->'juz_completed', '[30]'::JSONB);
  PERFORM hz_drop.eq('after: minority is recorded', public.set_profile_privacy(false, false, true, false)->>'is_minor', 'true');
END $$;
RESET ROLE;
DO $$
BEGIN
  PERFORM hz_drop.eq('after: recording minority cleared the photo', (
    SELECT avatar_url FROM public.profiles WHERE id = '00000000-0000-4000-8090-000000000001'
  ), NULL::TEXT);
END $$;

DELETE FROM auth.users WHERE id::TEXT LIKE '00000000-0000-4000-8090-%';
SET client_min_messages = warning;
DROP SCHEMA hz_drop CASCADE;
RESET client_min_messages;
\endif
