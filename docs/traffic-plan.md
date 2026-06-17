# MONSTARZ Traffic Plan

## 순간 유입 기준

방송 중 링크가 공유되어 홈과 모바일 첫 화면에 접속이 몰리는 상황을 기준으로 한다.

## 병목 후보

- 홈 초기 요청: LIVE API, 일정 API, 공지 JSON, 팬튜브 JSON 2개, Supabase public overrides.
- 티어표: Firebase `players/liveStatus/meta`와 선수별 전적 JSON.
- 영상/공지: GitHub raw JSON 의존.
- CCTV/방송도구: 여러 SOOP player iframe이 동시에 열릴 수 있다.
- 이미지: 방송 썸네일과 유튜브 썸네일이 한 화면에 많이 표시될 수 있다.

## 역할 분리

- GitHub Actions: ELO/전적/LIVE export와 자동화 로그 기록.
- Firebase: ELO, 전적, LIVE 원천 데이터 유지.
- Supabase: 관리자 메타데이터, 공지/영상 override, automation log.
- Vercel API: 공개 요약 API, 관리자 API 보호, Supabase service key 보호.
- Browser cache/localStorage: 공개 데이터 stale fallback.

## 운영 기준

- LIVE polling: PC 20초, 모바일 60초. LIVE TTL은 45초 기준.
- 일정 polling: 3분.
- 공지/영상 polling: PC는 기존 1분 호출이 있으나 service cache로 실제 네트워크 요청을 줄인다. 다음 단계에서 3~5분으로 늦추는 것을 권장한다.
- 관리자 API: no-store 유지, 공개 트래픽 경로에서 호출하지 않는다.
- CCTV: 사용자가 명시적으로 선택한 멤버만 iframe을 연다.

## 장애 fallback

- 외부 API 실패: 기존 cache가 있으면 stale 데이터를 표시한다.
- Supabase 미연결: 공개 사이트는 기존 JSON/Firebase 데이터로 계속 표시한다.
- 일정 API 실패: 홈에는 빈/오류 상태를 표시하고 일정표 iframe은 유지한다.
- LIVE API 실패: 기존 방송 상태를 유지하고 전체 오프라인으로 덮어쓰지 않는다.
- 이미지 실패: 팀 로고 fallback을 사용한다.

## 다음 확장

- LIVE API를 Vercel proxy로 감싸 s-maxage 30초 cache shield 적용.
- GitHub raw JSON을 public summary API로 묶어 홈 초기 요청 수 줄이기.
- 다운로드/자료실이 커지면 Supabase Storage signed URL 또는 CDN 적용.
- 강한 rate limit이 필요하면 Upstash/Redis/Cloudflare를 도입.
