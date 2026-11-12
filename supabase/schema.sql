-- ============================================================================
-- ROAMR Supabase PostgreSQL Schema & Row-Level Security
-- Run this entire script inside Supabase Dashboard -> SQL Editor -> New Query
-- Safe to re-run (idempotent).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. PROFILES (Real Travelers & Business Hosts + XP Leaderboard source)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  name text not null default 'ROAMR Explorer',
  avatar text,
  city text not null default 'San Francisco',
  interests text[] not null default array['food', 'photography', 'history'],
  paypal_email text,
  phone_number text,
  gender text,
  travel_style text,
  onboarding_done boolean not null default false,
  total_xp integer not null default 0 check (total_xp >= 0),
  stamps_count integer not null default 0 check (stamps_count >= 0),
  wallet_balance_cents integer not null default 0 check (wallet_balance_cents >= 0),
  is_traveler boolean not null default true,
  is_business boolean not null default false,
  business_name text,
  business_category text,
  business_address text,
  business_logo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Safely add any missing columns if public.profiles already existed
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists city text not null default 'San Francisco';
alter table public.profiles add column if not exists interests text[] not null default array['food', 'photography', 'history'];
alter table public.profiles add column if not exists paypal_email text;
alter table public.profiles add column if not exists phone_number text;
alter table public.profiles add column if not exists gender text;
alter table public.profiles add column if not exists travel_style text;
alter table public.profiles add column if not exists onboarding_done boolean not null default false;
alter table public.profiles add column if not exists total_xp integer not null default 0;
alter table public.profiles add column if not exists stamps_count integer not null default 0;
alter table public.profiles add column if not exists wallet_balance_cents integer not null default 0;
alter table public.profiles add column if not exists is_traveler boolean not null default true;
alter table public.profiles add column if not exists is_business boolean not null default false;
alter table public.profiles add column if not exists business_name text;
alter table public.profiles add column if not exists business_category text;
alter table public.profiles add column if not exists business_address text;
alter table public.profiles add column if not exists business_logo text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

create index if not exists profiles_leaderboard_idx
  on public.profiles (total_xp desc, stamps_count desc);

create index if not exists profiles_city_idx
  on public.profiles (lower(city));

-- Auto-update updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create profile row when a new Google / Email user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, avatar, is_traveler)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), 'ROAMR Explorer'),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture'),
    true
  )
  on conflict (id) do update
    set email = excluded.email,
        name = coalesce(nullif(public.profiles.name, ''), excluded.name),
        avatar = coalesce(public.profiles.avatar, excluded.avatar);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 2. QUESTS (Business-created, PayPal-funded exploration quests)
-- ----------------------------------------------------------------------------
create table if not exists public.quests (
  id text primary key,
  owner_id uuid references public.profiles (id) on delete set null,
  title text not null,
  business_name text not null,
  category text not null default 'Cafe',
  distance text not null default '0.5 km',
  xp integer not null default 50 check (xp >= 0),
  reward_cents integer not null default 50 check (reward_cents >= 0),
  difficulty text not null default 'Easy',
  est_time text not null default '~ 15 min',
  funded_by text not null,
  merchant_email text,
  min_checkin_cents integer not null default 100 check (min_checkin_cents >= 0),
  description text not null,
  objective text not null,
  proof_type text not null default 'photo_or_receipt',
  image text,
  latitude double precision not null,
  longitude double precision not null,
  city text not null default 'San Francisco',
  budget_cents integer not null default 500 check (budget_cents >= 0),
  spent_cents integer not null default 0 check (spent_cents >= 0),
  verified_visits integer not null default 0 check (verified_visits >= 0),
  funded boolean not null default false,
  paypal_order_id text,
  paypal_capture_id text,
  duration_hours integer,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quests_city_idx on public.quests (lower(city));
create index if not exists quests_owner_idx on public.quests (owner_id);

drop trigger if exists quests_set_updated_at on public.quests;
create trigger quests_set_updated_at
  before update on public.quests
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. QUEST SUBMISSIONS (AI Vision + Human Owner Verification workflow)
-- ----------------------------------------------------------------------------
create table if not exists public.quest_submissions (
  id text primary key,
  quest_id text not null references public.quests (id) on delete cascade,
  quest_title text not null,
  business_name text not null,
  traveler_id uuid references public.profiles (id) on delete set null,
  traveler_name text not null,
  traveler_email text,
  traveler_avatar text,
  paypal_email text not null,
  photo_uri text,
  ai_verified boolean not null default false,
  ai_confidence double precision not null default 0,
  ai_reason text not null default '',
  reward_cents integer not null default 50 check (reward_cents >= 0),
  xp integer not null default 50 check (xp >= 0),
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected')),
  review_note text,
  payout_id text,
  payout_status text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists submissions_quest_idx on public.quest_submissions (quest_id);
create index if not exists submissions_traveler_idx on public.quest_submissions (traveler_id);
create index if not exists submissions_status_idx on public.quest_submissions (status);

-- ----------------------------------------------------------------------------
-- 4. STAMPS (Earned Passport Stamps per Traveler)
-- ----------------------------------------------------------------------------
create table if not exists public.stamps (
  id text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  quest_id text not null,
  business_name text not null,
  quest_title text not null,
  category text not null default 'Cafe',
  xp integer not null default 50 check (xp >= 0),
  reward_cents integer not null default 50 check (reward_cents >= 0),
  photo_uri text,
  completed_at timestamptz not null default now()
);

create index if not exists stamps_user_idx on public.stamps (user_id, completed_at desc);

-- ----------------------------------------------------------------------------
-- 5. PAYOUTS (PayPal Sandbox Payouts Ledger)
-- ----------------------------------------------------------------------------
create table if not exists public.payouts (
  id text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  quest_id text not null,
  quest_title text not null,
  amount_cents integer not null check (amount_cents >= 0),
  status text not null,
  simulated boolean not null default false,
  debug_id text,
  receiver_email text not null,
  message text,
  created_at timestamptz not null default now()
);

create index if not exists payouts_user_idx on public.payouts (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 6. FUNDING ORDERS (Business PayPal Orders v2 Escrow Deposits)
-- ----------------------------------------------------------------------------
create table if not exists public.funding_orders (
  id text primary key,
  capture_id text,
  business_user_id uuid references public.profiles (id) on delete set null,
  quest_id text not null references public.quests (id) on delete cascade,
  quest_title text not null,
  amount_cents integer not null check (amount_cents >= 0),
  status text not null,
  simulated boolean not null default false,
  debug_id text,
  created_at timestamptz not null default now()
);

create index if not exists funding_orders_quest_idx on public.funding_orders (quest_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 6B. CLAIMS (End-to-End Check-In Order + GPS + Gemini Verdict + Business Review + Payout)
-- ----------------------------------------------------------------------------
create table if not exists public.claims (
  id text primary key,
  quest_id text not null,
  quest_title text not null,
  business_name text not null,
  traveler_name text not null,
  traveler_email text,
  traveler_avatar text,
  paypal_email text not null,
  order_id text,
  capture_id text,
  order_amount_cents integer not null default 0,
  order_status text,
  payee_email text,
  payer_name text,
  payer_email text,
  payer_id text,
  photo_uri text,
  latitude double precision,
  longitude double precision,
  mocked boolean not null default false,
  resolved_address text,
  distance_meters integer,
  demo_mode boolean not null default false,
  ai_verdict text,
  ai_confidence double precision,
  ai_reasons jsonb not null default '[]'::jsonb,
  hard_checks jsonb,
  status text not null default 'submitted' check (status in ('submitted', 'ai_reviewed', 'pending_business', 'approved', 'paid', 'rejected')),
  review_note text,
  payout_id text,
  payout_status text,
  webhook_status text,
  webhook_status_code integer,
  owner_notified boolean not null default false,
  review_token text,
  business_email text,
  submitted_at timestamptz not null default now(),
  ai_reviewed_at timestamptz,
  reviewed_at timestamptz,
  paid_at timestamptz
);

create index if not exists claims_quest_idx on public.claims (quest_id, submitted_at desc);
create index if not exists claims_status_idx on public.claims (status);

-- ----------------------------------------------------------------------------
-- 7. PUBLIC LEADERBOARD VIEW (Sorted real explorers only)
-- ----------------------------------------------------------------------------
create or replace view public.explorer_leaderboard
with (security_invoker = true) as
select
  id,
  name,
  avatar,
  city,
  total_xp,
  stamps_count,
  rank() over (order by total_xp desc, stamps_count desc, created_at asc) as global_rank
from public.profiles
where is_traveler = true;

-- ----------------------------------------------------------------------------
-- 8. ROW-LEVEL SECURITY (RLS) POLICIES
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.quests enable row level security;
alter table public.quest_submissions enable row level security;
alter table public.stamps enable row level security;
alter table public.payouts enable row level security;
alter table public.funding_orders enable row level security;
alter table public.claims enable row level security;

-- PROFILES
drop policy if exists "Public can read profiles for leaderboard" on public.profiles;
create policy "Public can read profiles for leaderboard"
  on public.profiles for select
  using (true);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- QUESTS
drop policy if exists "Anyone can view active quests" on public.quests;
create policy "Anyone can view active quests"
  on public.quests for select
  using (true);

drop policy if exists "Authenticated hosts can insert quests" on public.quests;
create policy "Authenticated hosts can insert quests"
  on public.quests for insert
  to authenticated
  with check (owner_id is null or auth.uid() = owner_id);

drop policy if exists "Authenticated users can update quests" on public.quests;
create policy "Authenticated users can update quests"
  on public.quests for update
  to authenticated
  using (true);

drop policy if exists "Owners can delete own quests" on public.quests;
create policy "Owners can delete own quests"
  on public.quests for delete
  to authenticated
  using (owner_id is null or auth.uid() = owner_id);

-- QUEST SUBMISSIONS
drop policy if exists "Authenticated users can view submissions" on public.quest_submissions;
create policy "Authenticated users can view submissions"
  on public.quest_submissions for select
  to authenticated
  using (true);

drop policy if exists "Travelers can submit proof" on public.quest_submissions;
create policy "Travelers can submit proof"
  on public.quest_submissions for insert
  to authenticated
  with check (traveler_id is null or auth.uid() = traveler_id);

drop policy if exists "Authenticated hosts can review submissions" on public.quest_submissions;
create policy "Authenticated hosts can review submissions"
  on public.quest_submissions for update
  to authenticated
  using (true);

-- STAMPS
drop policy if exists "Users read own stamps" on public.stamps;
create policy "Users read own stamps"
  on public.stamps for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users insert own stamps" on public.stamps;
create policy "Users insert own stamps"
  on public.stamps for insert
  to authenticated
  with check (auth.uid() = user_id);

-- PAYOUTS
drop policy if exists "Users read own payouts" on public.payouts;
create policy "Users read own payouts"
  on public.payouts for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users insert own payouts" on public.payouts;
create policy "Users insert own payouts"
  on public.payouts for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users update own payouts" on public.payouts;
create policy "Users update own payouts"
  on public.payouts for update
  to authenticated
  using (auth.uid() = user_id);

-- FUNDING ORDERS
drop policy if exists "Authenticated users read funding orders" on public.funding_orders;
create policy "Authenticated users read funding orders"
  on public.funding_orders for select
  to authenticated
  using (true);

drop policy if exists "Authenticated hosts insert funding orders" on public.funding_orders;
create policy "Authenticated hosts insert funding orders"
  on public.funding_orders for insert
  to authenticated
  with check (business_user_id is null or auth.uid() = business_user_id);

-- CLAIMS
drop policy if exists "Anyone can read claims" on public.claims;
create policy "Anyone can read claims"
  on public.claims for select
  using (true);

drop policy if exists "Authenticated or server insert claims" on public.claims;
create policy "Authenticated or server insert claims"
  on public.claims for insert
  to authenticated, anon
  with check (true);

drop policy if exists "Authenticated or server update claims" on public.claims;
create policy "Authenticated or server update claims"
  on public.claims for update
  to authenticated, anon
  using (true);
