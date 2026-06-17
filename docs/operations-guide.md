# 운영 가이드

## 데이터 갱신 확인

- 홈 방송 현황: LIVE 카드 수와 `방송 체크` 시간을 확인한다.
- 오늘 일정: `/api/schedule-today` 응답의 `items`와 `updatedAt`을 확인한다.
- 공지/영상: 홈 카드와 관리자 `데이터 상태`에서 건수와 오류 상태를 확인한다.
- 티어/전적: 티어표 탭 로딩 상태와 전적 모달을 확인한다.
- IN&OUT: 최신 항목이 홈과 히스토리 화면에 같이 반영되는지 확인한다.

## 자동화 실패 확인

- 관리자 `데이터 상태`에서 운영 진단과 자동 수집 로그를 확인한다.
- GitHub Actions 실패 시 실행 로그에서 원천 API 응답, Firebase/Supabase 쓰기 오류를 확인한다.
- Supabase 미연결이면 기존 JSON/Firebase fallback이 정상인지 먼저 확인한다.

## 관리자 저장 실패 확인

- `/api/admin/auth/status`가 `adminConfigured`, `supabaseReady`, `authed`를 올바르게 반환하는지 확인한다.
- 인증 실패는 `ADMIN_SECRET` 설정을 확인한다.
- Supabase 저장 실패는 table schema, RLS, service role key 설정을 확인한다.
- payload 오류는 API 응답의 `code`와 입력값 길이/URL 형식을 확인한다.

## 외부 API 장애 대응

- LIVE 장애: 기존 멤버 목록은 유지하고 방송중 카드만 빈 상태로 표시되는지 확인한다.
- 일정 장애: 홈 일정 섹션이 오류 문구를 보여주는지 확인한다.
- 공지/영상 장애: 이전 캐시 또는 빈 상태가 깨지지 않는지 확인한다.
- Firebase 장애: 티어표 오류 상태와 전적 모달 오류 문구를 확인한다.

## Vercel 배포 장애 대응

- GitHub main 최신 커밋이 Vercel에 연결되어 있는지 확인한다.
- 배포 로그에서 API 함수 번들 오류를 확인한다.
- 정적 파일 캐시가 오래 남으면 URL에 쿼리스트링을 붙여 최신 HTML 반영을 확인한다.

## 보안 원칙

- service role/private key는 브라우저 번들, 문서, 로그에 출력하지 않는다.
- 관리자 API는 인증 전 쓰기 동작을 허용하지 않는다.
- SOOP 토큰 응답은 원문 upstream 오류를 그대로 노출하지 않는다.
