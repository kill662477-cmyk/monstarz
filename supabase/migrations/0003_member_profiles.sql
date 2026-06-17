-- MONSTARZNEW: 프로필 탭 전용 테이블 (멤버 로스터와 분리)
-- 정보 > 프로필 탭의 상세 정보(생년월일/혈액형/MBTI/키/데뷔/수상/이미지)를 관리합니다.
-- members_admin(현황판 로스터)와는 별개입니다.
-- Supabase SQL Editor 에 붙여넣어 실행하세요. (Results 탭 "Success"면 완료)

create extension if not exists "pgcrypto";

create table if not exists public.member_profiles (
  id uuid primary key default gen_random_uuid(),
  member_code text,
  name text not null,
  role text,
  image text,
  fallback_image text,
  image_pos text,
  birth text,
  blood text,
  mbti text,
  height text,
  debut text,
  awards text,                -- 줄바꿈으로 구분된 수상경력
  sort_order integer default 0,
  is_visible boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  hidden_at timestamptz
);

create index if not exists idx_member_profiles_visible on public.member_profiles (is_visible);
create index if not exists idx_member_profiles_sort on public.member_profiles (sort_order);
create index if not exists idx_member_profiles_code on public.member_profiles (member_code);

-- updated_at 자동 갱신 (0001 의 set_updated_at 함수 재사용; 없으면 아래 주석 해제)
-- create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_set_updated_at on public.member_profiles;
create trigger trg_set_updated_at before update on public.member_profiles for each row execute function public.set_updated_at();

-- RLS: 공개는 is_visible=true 만 SELECT, 쓰기는 서버 service key 로만
alter table public.member_profiles enable row level security;
drop policy if exists "public_select_visible" on public.member_profiles;
create policy "public_select_visible" on public.member_profiles for select to anon, authenticated using (is_visible = true);
