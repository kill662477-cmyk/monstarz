# 자동화 문제 해결 (MONSTARZNEW)

자동 수집/저장이 이상할 때 확인하는 순서입니다.

## 1. GitHub Actions 실패

- GitHub Actions 탭에서 실패한 workflow와 step 로그를 확인합니다.
- `workflow_dispatch`가 있는 작업은 `Run workflow`로 수동 재실행할 수 있습니다.
- secret 누락 여부는 `docs/github-actions-secrets.md`를 기준으로 확인합니다.
- `collect-tier-data`, `sync-soop-live`, `export-manual-players`는 Supabase가 연결되어 있으면 `automation_runs`에 실패 로그도 남깁니다.

## 2. Firebase 저장 실패

- `FIREBASE_SERVICE_ACCOUNT_JSON`과 `FIREBASE_DATABASE_URL` 유효성을 확인합니다.
- 쓰기 경로가 `starcraftTier/current` 계열인지 확인합니다.
- Firebase 실패 또는 ELO 파싱 실패가 발생하면 기존 성공 데이터를 덮어쓰지 않는 것이 원칙입니다.

## 3. Supabase 로그/저장 실패

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`가 Actions/Vercel에 설정되어 있는지 확인합니다.
- `supabase/migrations/0002_automation_runs.sql` 적용 여부를 확인합니다.
- `automation_runs` 기록 실패는 본 수집 작업을 실패시키지 않습니다.
- 단, 본 수집 작업 자체가 실패하면 Actions는 실패로 종료되어야 합니다.

## 4. 빈 데이터 방지

- 수집 결과가 0건이면 원천 사이트 장애, 차단, HTML 구조 변경, 쿼터 제한을 의심합니다.
- ELO/전적은 선수별 실패를 보존 처리하고, 전체 실패는 Actions 실패로 남깁니다.
- LIVE 동기화는 SOOP API 정상 페이지를 하나도 읽지 못하면 Firebase를 덮어쓰지 않습니다.
- 수동 players export는 결과가 0명이면 JSON을 쓰지 않습니다.

## 5. 공개 화면 확인

- Supabase 미연결이어도 기존 JSON/Firebase fallback으로 공개 화면이 동작해야 합니다.
- 공지/영상 숨김/고정은 `/api/public-overrides`가 Supabase service key로 public-safe 메타만 내려주는 구조입니다.
- 이 API가 실패하면 기존 공지/영상 원본 목록을 그대로 사용합니다.

## 6. 관리자 데이터 상태

- PC `/admin`의 `데이터 상태` 섹션에서 `automation_runs` 요약과 최근 로그를 확인합니다.
- 모바일 관리자 화면도 인증/연결 상태에서 최근 automation 로그를 간단히 표시합니다.

## 7. 실패 후 데이터 보존 원칙

- 성공 시에만 저장합니다.
- 비정상 0건이면 저장하지 않습니다.
- 네트워크/API/파싱 오류 시 기존 성공 데이터를 유지합니다.
- 실패 원인은 `automation_runs.error_message` 또는 Actions 로그에 남깁니다.
