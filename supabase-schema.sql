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
