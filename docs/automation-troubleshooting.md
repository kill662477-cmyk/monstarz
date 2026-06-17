# 자동화 문제 해결 (MONSTARZNEW)

자동 수집/저장이 이상할 때 확인하는 순서입니다.

## 1. GitHub Actions 실패 시
- GitHub → Actions 탭에서 실패한 워크플로우의 로그 확인.
- 빨간 단계(step)의 에러 메시지 확인 (네트워크/타임아웃/파싱/인증).
- secret 누락 여부 확인 (`docs/github-actions-secrets.md`).
- 일시적 실패면 **수동 재실행**: 해당 워크플로우 → `Run workflow` (workflow_dispatch).

## 2. Firebase 저장 실패 시
- `FIREBASE_SERVICE_ACCOUNT` / `FIREBASE_DATABASE_URL` 유효성 확인.
- RTDB 규칙/권한 확인.
- 쓰기 경로(`starcraftTier/current` 등)가 다른 작업과 충돌하는지 확인.
- 중요: 실패해도 **기존 데이터는 덮어쓰지 않음**이 원칙. 0건/오류 시 저장 스킵.

## 3. Supabase 저장 실패 시
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 확인.
- 테이블/마이그레이션 적용 여부 확인 (`supabase/migrations/`).
- RLS 로 인해 anon 키로는 쓰기 불가 — 반드시 service 키 사용.
- `automation_runs` 기록 실패는 **본 수집 작업을 실패시키지 않음** (로거가 예외를 흡수).

## 4. 빈 데이터가 들어왔을 때 (가장 중요)
- 수집 결과가 0건이거나 필수 필드가 비면 **저장하지 말 것**.
- 기존 성공 데이터를 유지하고 `automation_runs.status = "skipped"` 로 기록.
- 원인: 원천 사이트 점검/차단/HTML 구조 변경/레이트리밋.

## 5. API key 만료/제한 의심 시
- YouTube/외부 API 쿼터 초과 여부 확인 (콘솔의 quota).
- SOOP 토큰 만료 시 `api/soop-refresh.js` 흐름 확인.
- 401/403/429 응답이면 키/쿼터/레이트리밋 문제.

## 6. 수동 실행 (workflow_dispatch)
- GitHub → Actions → 해당 워크플로우 → `Run workflow` 버튼.
- 워크플로우에 `on: workflow_dispatch:` 가 있어야 수동 버튼이 보입니다.

## 7. 실패 후 데이터 보존 원칙 (요약)
- 성공 시에만 저장 / 0건이면 보존 / 오류 시 기존 유지 / 저장 전 검증 / 갱신 시각 기록 / 실패 로그 남김.
- 자세한 역할 분리는 `docs/automation-map.md` 참고.

## 8. 관리자 화면에서 상태 보기
- `/admin` → **데이터 상태** 섹션. Supabase 연결 시 `automation_runs` 최근 실행이 표시됩니다.
- 미연결 시에는 프론트가 가진 최신 갱신 시각(LIVE/공지/영상) 기준으로 표시됩니다.
