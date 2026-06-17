-- MONSTARZNEW Phase 6: 자동 수집 상태 로그 테이블
-- 0001 실행 후 SQL Editor 에 그대로 붙여넣어 실행하세요. (Results 탭이 "Success"면 완료)
-- automation_runs 는 GitHub Actions / 서버 수집 작업의 실행 상태를 기록합니다.
-- 공개(anon)는 읽지 못합니다. 서버(service_role) 와 관리자 API 만 접근합니다.

create extension if not exists "pgcrypto";

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  job_type text,
  status text not null,            -- success | failed | skipped | partial
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  source text,                     -- 수집 원천 (eloboard, soop, youtube ...)
  target text,                     -- 저장 위치 (firebase, supabase, json ...)
  items_found integer default 0,
  items_written integer default 0,
  items_skipped integer default 0,
  error_message text,
  meta jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_automation_runs_job on public.automation_runs (job_name);
create index if not exists idx_automation_runs_status on public.automation_runs (status);
create index if not exists idx_automation_runs_created on public.automation_runs (created_at desc);

-- RLS: 활성화하고, anon/authenticated 용 정책을 만들지 않음 = 공개 읽기/쓰기 모두 거부.
-- 서버의 service_role 키는 RLS 를 우회하므로 수집 스크립트와 관리자 API 만 접근 가능합니다.
alter table public.automation_runs enable row level security;
