# 자동화 역할 맵 (MONSTARZNEW)

6차 패치 기준 자동 수집/저장 역할 분리 문서입니다. 기존 GitHub Actions와 Firebase 기반 티어/전적/LIVE 파이프라인은 유지하고, Supabase는 관리 데이터와 보조 메타/자동화 로그 저장소로 병행합니다.

## 저장소별 역할

| 영역 | 담당 | 원칙 |
|---|---|---|
| GitHub Actions | ELO/전적, SOOP Live, 수동 플레이어 export, 향후 공지/영상/위클리/월간 기초 계산 | 계속 자동 수집 엔진으로 사용 |
| Firebase | 기존 티어/전적 원천, LIVE 상태, 실시간성 데이터 | 이번 패치에서 Supabase로 강제 이전하지 않음 |
| Supabase | 일정/IN&OUT/링크/자료실, 공지/영상 메타, 수동 등록 영상, 위클리/월간 확정값, `automation_runs` | 관리성/보조/확정 저장소 |
| Vercel API | 관리자 인증/저장, 자동화 상태 조회, 공개 override 메타 제공 | service key는 서버에서만 사용 |
| 정적 JSON/외부 API | 기존 공지/영상/일정 fallback | 실패 시 기존 화면 유지 |

## 현재 GitHub Actions

| 워크플로우 | 실행 주기 | 수집/작업 대상 | 저장 위치 | 실패 안전성 | 환경변수/Secrets |
|---|---|---|---|---|---|
| `Collect Tier Data` (`collect-tier.yml`) | 8시간마다 + 수동 | 수동 멤버, ELOBOARD 전적 | Firebase `starcraftTier/current` | 수집/파싱 실패 선수는 기존 recordMeta 보존, 작업 실패는 `automation_runs` 기록 후 Actions 실패 | `FIREBASE_DATABASE_URL`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `Sync SOOP Live To Firebase` (`sync-live.yml`) | 3분마다 + 수동 | SOOP 방송 상태 | Firebase liveStatus/players/meta | SOOP API 정상 페이지가 0개면 저장하지 않고 실패 처리 | `FIREBASE_DATABASE_URL`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `SOOP_CLIENT_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `Export Manual Players` (`export-manual-players.yml`) | 수동 | Firebase players -> 수동 players JSON | `data/manual/players.json` | export 결과 0명일 때 파일 덮어쓰기 금지 | `FIREBASE_DATABASE_URL`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `Test ELOBOARD Records` (`test-eloboard-records.yml`) | 수동 | ELOBOARD 파싱 테스트 | artifact report | 테스트용, 저장소 데이터 덮어쓰기 없음 | secret 불필요 |

## 자동화 로그

- 공통 로거: `scripts/lib/automationLogger.js`
- 저장 테이블: Supabase `automation_runs`
- Supabase 미연결 또는 로그 저장 실패 시 콘솔 로그만 남기고 본 수집은 계속 진행합니다.
- 본 수집 자체가 실패하면 `automation_runs.status=failed` 기록을 시도한 뒤 GitHub Actions도 실패 상태가 됩니다.

## 공지/영상 병합

| 데이터 | 원본 | Supabase 병행 데이터 | 공개 표시 방식 |
|---|---|---|---|
| 공지 | 기존 JSON/외부 수집 결과 | `notices_meta` 숨김/고정/제목 보정 | `/api/public-overrides`에서 public-safe 메타를 받아 원본과 병합 |
| 영상 | 기존 YouTube/팬튜브 JSON | `videos` 수동 등록/숨김/고정 | 중복 URL 제거, 숨김 URL 제외, 고정 영상 우선 |

## 실패 안전 원칙

1. 새 데이터 수집이 성공했을 때만 저장합니다.
2. 비정상 0건 결과로 기존 데이터를 덮어쓰지 않습니다.
3. API/파싱/네트워크 오류 시 기존 성공 데이터를 유지합니다.
4. 저장 전 데이터 개수와 필수 필드를 검증합니다.
5. 저장 후 갱신 시각과 건수를 기록합니다.
6. 실패는 `automation_runs` 또는 콘솔에 명확히 남깁니다.

## 향후 자동화 후보

| 작업 | 권장 담당 | 저장 위치 |
|---|---|---|
| SOOP 공지 수집 | GitHub Actions | 원본 JSON/Firebase + `notices_meta` |
| 팬튜브/보자충 자동 수집 | GitHub Actions | 원본 JSON + `videos` |
| 위클리 베스트 후보 계산 | GitHub Actions 또는 수동 | 자동 후보 JSON + `weekly_best_manual` 확정값 |
| 월간결산 기초 계산 | GitHub Actions 또는 수동 | 기초 JSON + `monthly_reports` 확정값 |
