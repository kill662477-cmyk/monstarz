# 자동화 역할 맵 (MONSTARZNEW)

이 문서는 자동 수집/저장의 **역할 분리**를 정리합니다. (Phase 6)

> 현재 상태 주의: 이 워크트리에는 `.github/workflows/` 와 원래 수집 스크립트
> (`scripts/sync-soop-live-to-firebase.js`, `scripts/collect-data.js` 등)가 **삭제된 상태**입니다.
> (이전 단계에서 발생한 삭제로, 되돌리지 않습니다.) 실제 파이프라인은 GitHub 저장소 쪽에
> 남아 있을 수 있으며, 이 문서는 **유지해야 할 역할과 원칙**을 기준으로 정리합니다.
> 루트의 `collect-data.js`(ELO/전적 수집기, Firebase 저장)는 디스크에 남아 있습니다.

## 저장소별 역할

| 저장소 | 담당 데이터 | 비고 |
|---|---|---|
| **GitHub Actions** | 자동 수집 엔진 (ELO/전적, SOOP Live, 공지, VOD, 유튜브/팬튜브, 위클리/월간 기초 계산) | 계속 사용. 삭제 금지 |
| **Firebase** | 티어/전적 원천, 방송중 LIVE 상태, 기존 실시간 데이터 | 유지. 강제 이전 금지 |
| **Supabase** | 관리 데이터(일정/IN&OUT/링크/자료실), 공지/영상 메타(숨김·고정), 영상 수동 등록, 위클리/월간 확정값, 자동화 로그(`automation_runs`) | Phase 5~6에서 부분 도입 |
| **Vercel API (`api/`)** | 관리자 저장/수정/숨김, 권한 확인, 공개 설정, 자동 수집 상태 조회 | 서버 전용 키 사용 |

## 작업별 정리

| 작업 | 실행 주체 | 권장 주기 | 수집 대상 | 저장 위치 | 실패 처리 | 수정 필요 |
|---|---|---|---|---|---|---|
| ELO/전적 수집 | GitHub Actions (`collect-data.js`) | 기존 주기 유지 | ELOBOARD 전적 | Firebase | 0건/오류 시 기존 보존 | 유지 |
| SOOP Live 동기화 | GitHub Actions | 기존 ~3분 | SOOP 방송 상태 | Firebase | 오류 시 기존 보존 | 유지 |
| 공지 수집 | GitHub Actions | 5~30분 | SOOP 공지 | JSON/Firebase (원본) | 0건 시 기존 보존 | 유지 + Supabase `notices_meta` 병합 |
| 유튜브/팬튜브 수집 | GitHub Actions | 5~30분 | YouTube | JSON (원본) | 0건 시 기존 보존 | 유지 + Supabase `videos` 병행 |
| 위클리 베스트 | Actions 또는 수동 | 주 1회 | ELO/전적 기반 | Supabase `weekly_best_manual`(확정값) | 확정값 우선 | 기반 준비 |
| 월간결산 | 반자동 (Actions 기초 + 관리자 확정) | 월 1회 | 기초 통계 | Supabase `monthly_reports`(확정값) | 확정값 우선 | 기반 준비 |
| 자동화 로그 | 모든 수집 작업 | 매 실행 | 실행 상태 | Supabase `automation_runs` | 로그 실패는 무시 | Phase 6 추가 |

## 실패 안전 원칙 (모든 수집 공통)
1. 새 데이터 수집 **성공 시에만** 저장한다.
2. 결과가 비정상 0건이면 기존 데이터를 **덮어쓰지 않는다**.
3. API/파싱/네트워크 오류 시 기존 성공 데이터를 **유지**한다.
4. 저장 전 데이터 개수와 필수 필드를 검증한다.
5. 저장 후 갱신 시각을 기록한다.
6. 실패는 `automation_runs` 또는 콘솔에 명확히 남긴다.

## 자동화 로그 사용법
수집 스크립트에서 `scripts/lib/automationLogger.js` 의 `withAutomationLog` 로 감싸면
시작/종료/성공/실패/건수가 `automation_runs` 에 자동 기록됩니다. Supabase 미연결이면 콘솔만 남깁니다.
관리자 화면(`/admin` → 데이터 상태)에서 `automation_runs` 를 읽어 표시합니다.
