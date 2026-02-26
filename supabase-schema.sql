-- ============================================================
-- Hafiz – Supabase Remote Schema
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard)
-- ============================================================

-- 1. Profiles table (auto-created on signup via trigger)
create table if not exists public.profiles (
  id         uuid references auth.users on delete cascade primary key,
  username   text,
  score      integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- 2. Study log table (mirrors local SQLite study_log)
create table if not exists public.study_log (
  user_id          uuid references auth.users on delete cascade not null,
  surah            integer not null,
  ayah             integer not null,
  interval         real not null default 0,
  repetitions      integer not null default 0,
  ease_factor      real not null default 2.5,
  next_review_date text not null default '',
  last_review_date text not null default '',
  updated_at       timestamptz not null default now(),
  primary key (user_id, surah, ayah)
);

alter table public.study_log enable row level security;

create policy "Users can read own study_log"
  on public.study_log for select
  using (auth.uid() = user_id);

create policy "Users can insert own study_log"
  on public.study_log for insert
  with check (auth.uid() = user_id);

create policy "Users can update own study_log"
  on public.study_log for update
  using (auth.uid() = user_id);

-- 3. Trigger: auto-create profile row on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id)
  values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4. Function: recalculate score from study_log
create or replace function public.recalc_score(uid uuid)
returns void as $$
begin
  update public.profiles
  set score = (
    select coalesce(count(*), 0)
    from public.study_log
    where user_id = uid and repetitions > 0
  )
  where id = uid;
end;
$$ language plpgsql security definer;

-- ============================================================
-- Phase 6: Community & Leaderboard
-- ============================================================

-- 5. Alter profiles: add display_name, streak columns
alter table public.profiles
  add column if not exists display_name text,
  add column if not exists current_streak integer not null default 0,
  add column if not exists longest_streak integer not null default 0;

-- Replace restrictive "read own profile" with leaderboard-friendly policy
drop policy if exists "Users can read own profile" on public.profiles;
create policy "Authenticated can read all profiles"
  on public.profiles for select
  using (auth.role() = 'authenticated');

-- 6. Posts table
create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users on delete cascade not null,
  surah      integer not null,
  ayah       integer not null,
  ayah_text  text not null,
  content    text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.posts enable row level security;

create policy "Authenticated can read all posts"
  on public.posts for select
  using (auth.role() = 'authenticated');

create policy "Users can insert own posts"
  on public.posts for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own posts"
  on public.posts for delete
  using (auth.uid() = user_id);

-- 7. Comments table
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid references public.posts on delete cascade not null,
  user_id    uuid references auth.users on delete cascade not null,
  content    text not null check (char_length(content) between 1 and 1000),
  created_at timestamptz not null default now()
);

alter table public.comments enable row level security;

create policy "Authenticated can read all comments"
  on public.comments for select
  using (auth.role() = 'authenticated');

create policy "Users can insert own comments"
  on public.comments for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own comments"
  on public.comments for delete
  using (auth.uid() = user_id);

-- 8. Likes table (composite PK)
create table if not exists public.likes (
  user_id    uuid references auth.users on delete cascade not null,
  post_id    uuid references public.posts on delete cascade not null,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

alter table public.likes enable row level security;

create policy "Authenticated can read all likes"
  on public.likes for select
  using (auth.role() = 'authenticated');

create policy "Users can insert own likes"
  on public.likes for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own likes"
  on public.likes for delete
  using (auth.uid() = user_id);

-- 9. View: posts with author + counts
create or replace view public.posts_with_counts as
select
  p.id,
  p.user_id,
  p.surah,
  p.ayah,
  p.ayah_text,
  p.content,
  p.created_at,
  coalesce(pr.display_name, pr.username, 'Anonymous') as author_name,
  (select count(*) from public.likes l where l.post_id = p.id) as like_count,
  (select count(*) from public.comments c where c.post_id = p.id) as comment_count
from public.posts p
left join public.profiles pr on pr.id = p.user_id;

-- 10. Function: update streak from study_log review dates
create or replace function public.update_streak(uid uuid)
returns void as $$
declare
  streak integer := 0;
  longest integer := 0;
  prev_date date := null;
  r record;
begin
  for r in
    select distinct last_review_date::date as d
    from public.study_log
    where user_id = uid and last_review_date <> ''
    order by d desc
  loop
    if prev_date is null then
      if r.d >= current_date - interval '1 day' then
        streak := 1;
      else
        streak := 0;
        exit;
      end if;
    elsif prev_date - r.d = 1 then
      streak := streak + 1;
    else
      exit;
    end if;
    prev_date := r.d;
  end loop;

  -- compute longest streak separately
  prev_date := null;
  declare run integer := 0;
  begin
    for r in
      select distinct last_review_date::date as d
      from public.study_log
      where user_id = uid and last_review_date <> ''
      order by d asc
    loop
      if prev_date is null or r.d - prev_date = 1 then
        run := run + 1;
      else
        run := 1;
      end if;
      if run > longest then longest := run; end if;
      prev_date := r.d;
    end loop;
  end;

  update public.profiles
  set current_streak = streak, longest_streak = longest
  where id = uid;
end;
$$ language plpgsql security definer;
