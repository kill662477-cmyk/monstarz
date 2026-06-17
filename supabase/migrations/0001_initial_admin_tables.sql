-- MONSTARZNEW Phase 5: 초기 관리자 테이블 + RLS
-- Supabase 프로젝트 생성 후 SQL Editor에 그대로 붙여넣어 실행하세요.
-- 안전하게 여러 번 실행해도 되도록 IF NOT EXISTS / CREATE OR REPLACE 를 사용합니다.
-- 실제 삭제(hard delete)는 사용하지 않습니다. 숨김은 is_visible=false + hidden_at 로 처리합니다.

-- gen_random_uuid() 사용을 위한 확장
create extension if not exists "pgcrypto";

-- ============================================================
-- updated_at 자동 갱신 트리거 함수 (공통)
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- 1) members_admin : 멤버 관리(추가/수정/숨김)
-- ============================================================
create table if not exists public.members_admin (
  id uuid primary key default gen_random_uuid(),
  member_code text unique,
  name text not null,
  race text,
  tier text,
  role text,
  soop_id text,
  youtube_url text,
  profile_image text,
  sort_order integer default 0,
  is_visible boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  hidden_at timestamptz
);
create index if not exists idx_members_admin_visible on public.members_admin (is_visible);
create index if not exists idx_members_admin_sort on public.members_admin (sort_order);
create index if not exists idx_members_admin_code on public.members_admin (member_code);
create index if not exists idx_members_admin_created on public.members_admin (created_at);

-- ============================================================
-- 2) schedules : 일정 관리
-- ============================================================
create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  start_at timestamptz,
  end_at timestamptz,
  event_date date,
  description text,
  members text[],
  status text default 'scheduled',
  sort_order integer default 0,
  is_visible boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  hidden_at timestamptz
);
create index if not exists idx_schedules_visible on public.schedules (is_visible);
create index if not exists idx_schedules_sort on public.schedules (sort_order);
create index if not exists idx_schedules_start on public.schedules (start_at);
create index if not exists idx_schedules_event_date on public.schedules (event_date);

-- ============================================================
-- 3) videos : 영상 관리(팬튜브/보자충 큐레이션, 고정)
-- ============================================================
create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  platform text,
  member_code text,
  url text not null,
  published_at timestamptz,
  thumbnail text,
  is_pinned boolean default false,
  sort_order integer default 0,
  is_visible boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  hidden_at timestamptz
);
create index if not exists idx_videos_visible on public.videos (is_visible);
create index if not exists idx_videos_sort on public.videos (sort_order);
create index if not exists idx_videos_published on public.videos (published_at);
create index if not exists idx_videos_member on public.videos (member_code);

-- ============================================================
-- 4) notices_meta : 공지 메타(자동 수집 공지의 숨김/고정 보정)
--    원본 공지는 기존 JSON에서 오고, 여기서는 source_key 로 메타만 관리합니다.
-- ============================================================
create table if not exists public.notices_meta (
  id uuid primary key default gen_random_uuid(),
  source_key text unique,
  title text,
  station_name text,
  link text,
  notice_date text,
  is_pinned boolean default false,
  sort_order integer default 0,
  is_visible boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  hidden_at timestamptz
);
create index if not exists idx_notices_meta_visible on public.notices_meta (is_visible);
create index if not exists idx_notices_meta_source on public.notices_meta (source_key);
create index if not exists idx_notices_meta_sort on public.notices_meta (sort_order);

-- ============================================================
-- 5) inout_events : IN&OUT 관리
-- ============================================================
create table if not exists public.inout_events (
  id uuid primary key default gen_random_uuid(),
  member_name text not null,
  event_type text not null check (event_type in ('IN','OUT')),
  event_date date,
  race text,
  description text,
  sort_order integer default 0,
  is_visible boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  hidden_at timestamptz
);
create index if not exists idx_inout_visible on public.inout_events (is_visible);
create index if not exists idx_inout_event_date on public.inout_events (event_date);
create index if not exists idx_inout_sort on public.inout_events (sort_order);

-- ============================================================
-- 6) external_links : 외부 링크 관리(공개/비공개/정렬)
-- ============================================================
create table if not exists public.external_links (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  url text not null,
  category text,
  note text,
  sort_order integer default 0,
  is_visible boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  hidden_at timestamptz
);
create index if not exists idx_links_visible on public.external_links (is_visible);
create index if not exists idx_links_sort on public.external_links (sort_order);
create index if not exists idx_links_category on public.external_links (category);

-- ============================================================
-- 7) resources : 자료실
-- ============================================================
create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  url text,
  category text,
  description text,
  sort_order integer default 0,
  is_visible boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  hidden_at timestamptz
);
create index if not exists idx_resources_visible on public.resources (is_visible);
create index if not exists idx_resources_sort on public.resources (sort_order);
create index if not exists idx_resources_category on public.resources (category);

-- ============================================================
-- 8) weekly_best_manual : 주간 베스트 수동 큐레이션
-- ============================================================
create table if not exists public.weekly_best_manual (
  id uuid primary key default gen_random_uuid(),
  week_label text,
  member_code text,
  title text,
  note text,
  sort_order integer default 0,
  is_visible boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  hidden_at timestamptz
);
create index if not exists idx_weekly_best_visible on public.weekly_best_manual (is_visible);
create index if not exists idx_weekly_best_sort on public.weekly_best_manual (sort_order);
create index if not exists idx_weekly_best_member on public.weekly_best_manual (member_code);

-- ============================================================
-- 9) monthly_reports : 월간 결산
-- ============================================================
create table if not exists public.monthly_reports (
  id uuid primary key default gen_random_uuid(),
  month_label text,
  title text,
  summary text,
  url text,
  published_at timestamptz,
  sort_order integer default 0,
  is_visible boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  hidden_at timestamptz
);
create index if not exists idx_monthly_visible on public.monthly_reports (is_visible);
create index if not exists idx_monthly_sort on public.monthly_reports (sort_order);
create index if not exists idx_monthly_published on public.monthly_reports (published_at);

-- ============================================================
-- updated_at 트리거 연결 (모든 테이블)
-- ============================================================
-- (SQL 에디터 호환을 위해 DO 블록 대신 테이블별 일반 문장으로 작성)
drop trigger if exists trg_set_updated_at on public.members_admin;
create trigger trg_set_updated_at before update on public.members_admin for each row execute function public.set_updated_at();
drop trigger if exists trg_set_updated_at on public.schedules;
create trigger trg_set_updated_at before update on public.schedules for each row execute function public.set_updated_at();
drop trigger if exists trg_set_updated_at on public.videos;
create trigger trg_set_updated_at before update on public.videos for each row execute function public.set_updated_at();
drop trigger if exists trg_set_updated_at on public.notices_meta;
create trigger trg_set_updated_at before update on public.notices_meta for each row execute function public.set_updated_at();
drop trigger if exists trg_set_updated_at on public.inout_events;
create trigger trg_set_updated_at before update on public.inout_events for each row execute function public.set_updated_at();
drop trigger if exists trg_set_updated_at on public.external_links;
create trigger trg_set_updated_at before update on public.external_links for each row execute function public.set_updated_at();
drop trigger if exists trg_set_updated_at on public.resources;
create trigger trg_set_updated_at before update on public.resources for each row execute function public.set_updated_at();
drop trigger if exists trg_set_updated_at on public.weekly_best_manual;
create trigger trg_set_updated_at before update on public.weekly_best_manual for each row execute function public.set_updated_at();
drop trigger if exists trg_set_updated_at on public.monthly_reports;
create trigger trg_set_updated_at before update on public.monthly_reports for each row execute function public.set_updated_at();

-- ============================================================
-- RLS: 모든 테이블 활성화
--  - 공개(anon)는 is_visible = true 인 행만 SELECT 가능
--  - anon / authenticated 의 INSERT / UPDATE / DELETE 는 정책을 만들지 않아 모두 차단됨
--  - 쓰기는 서버 API route 에서 service_role 키로만 처리 (service_role 은 RLS 우회)
-- ============================================================
-- (테이블별 명시적 설정. anon/authenticated 의 insert/update/delete 정책은
--  일부러 만들지 않습니다 = 공개 쓰기 거부. 쓰기는 서버 API 의 service 키로만.)
alter table public.members_admin enable row level security;
drop policy if exists "public_select_visible" on public.members_admin;
create policy "public_select_visible" on public.members_admin for select to anon, authenticated using (is_visible = true);

alter table public.schedules enable row level security;
drop policy if exists "public_select_visible" on public.schedules;
create policy "public_select_visible" on public.schedules for select to anon, authenticated using (is_visible = true);

alter table public.videos enable row level security;
drop policy if exists "public_select_visible" on public.videos;
create policy "public_select_visible" on public.videos for select to anon, authenticated using (is_visible = true);

alter table public.notices_meta enable row level security;
drop policy if exists "public_select_visible" on public.notices_meta;
create policy "public_select_visible" on public.notices_meta for select to anon, authenticated using (is_visible = true);

alter table public.inout_events enable row level security;
drop policy if exists "public_select_visible" on public.inout_events;
create policy "public_select_visible" on public.inout_events for select to anon, authenticated using (is_visible = true);

alter table public.external_links enable row level security;
drop policy if exists "public_select_visible" on public.external_links;
create policy "public_select_visible" on public.external_links for select to anon, authenticated using (is_visible = true);

alter table public.resources enable row level security;
drop policy if exists "public_select_visible" on public.resources;
create policy "public_select_visible" on public.resources for select to anon, authenticated using (is_visible = true);

alter table public.weekly_best_manual enable row level security;
drop policy if exists "public_select_visible" on public.weekly_best_manual;
create policy "public_select_visible" on public.weekly_best_manual for select to anon, authenticated using (is_visible = true);

alter table public.monthly_reports enable row level security;
drop policy if exists "public_select_visible" on public.monthly_reports;
create policy "public_select_visible" on public.monthly_reports for select to anon, authenticated using (is_visible = true);
