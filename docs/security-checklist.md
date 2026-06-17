# MONSTARZ Security Checklist

## 환경변수 규칙

- 브라우저 노출 가능: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- 서버 전용: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `ADMIN_SECRET`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `SOOP_CLIENT_SECRET`.
- 문서, 로그, UI에는 secret 값을 출력하지 않는다. 운영 진단 화면은 설정 여부만 표시한다.

## 관리자 API 보호 기준

- `/api/admin/*`의 조회/쓰기 리소스는 httpOnly `mz_admin` 쿠키가 있어야 동작한다.
- 로그인은 `ADMIN_SECRET`과 timing-safe compare로 확인한다.
- 관리자 API는 `Cache-Control: no-store`를 유지한다.
- POST/PATCH 본문은 64KB를 넘기지 않는다.
- 입력 필드는 table별 whitelist만 허용한다.
- URL 필드는 `http:`/`https:`만 허용한다.
- 실제 삭제는 구현하지 않고 `is_visible=false` soft hide만 사용한다.
- 401/403/429/500 응답은 내부 key, secret, raw stack을 포함하지 않는다.

## Rate Limit

- 관리자 API 전체: IP 기준 1분 240회, 쓰기성 method는 1분 90회.
- 관리자 로그인: IP 기준 1분 8회.
- SOOP token/refresh proxy: IP 기준 1분 20/30회.
- 현재 구현은 Vercel 서버리스 메모리 기반이라 인스턴스 간 공유되지 않는다. 강한 방어가 필요하면 Upstash/Redis/Cloudflare Rate Limiting으로 이전한다.

## Supabase 점검

- RLS는 public table에서 `is_visible=true` select 정책을 기준으로 둔다.
- anon/publishable key로 insert/update/delete가 열려 있지 않은지 확인한다.
- service role key는 `lib/supabase/admin.js`와 API route/server script에서만 사용한다.
- 공개 API `/api/public-overrides`는 숨김 영상의 민감 제목을 반환하지 않고 URL/hide metadata만 반환한다.

## Firebase 점검

- Realtime Database public write가 과도하게 열려 있지 않은지 rules를 확인한다.
- ELO/전적/LIVE 원천 데이터는 Firebase 유지. 이번 패치에서 DB 이전 없음.
- GitHub Actions service account key는 Actions secret으로만 관리한다.
- 브라우저 번들에는 service account나 admin credential을 넣지 않는다.

## XSS/HTML 렌더링 기준

- 사용자/외부 데이터는 기존 `escapeHtml`/`esc` 경로를 유지한다.
- 임베드 HTML이 필요한 SOOP oEmbed는 기존 경로를 유지하되, 추후 sandbox allowlist를 검토한다.
- 관리자 입력값은 URL/문자열 길이/허용 필드 검증을 거친다.

## 남은 TODO

- Supabase SQL 정책을 실제 프로젝트에서 재점검하고 결과를 `docs/supabase-setup.md`에 반영.
- 관리자 인증을 장기적으로 Supabase Auth 또는 별도 OAuth로 교체.
- 업로드/다운로드 기능이 추가될 때 파일 크기, 확장자, signed URL 정책을 반드시 추가.
