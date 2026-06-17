# MONSTARZ Performance Checklist

## 7차 분석 요약

- 요청이 많은 페이지: 홈은 LIVE, 오늘 일정, 팬튜브 2개 JSON, 공지 JSON, Supabase public overrides를 초기에 호출한다. 티어표는 Firebase `players/liveStatus/meta`와 선수별 전적 JSON을 추가로 읽는다.
- 중복 fetch 후보: PC와 모바일 모두 홈/상세가 같은 LIVE, 일정, 공지, 영상 데이터를 재사용한다. `services/data-services.js`의 memory/localStorage cache와 in-flight dedupe를 기준으로 통합한다.
- 캐시 미적용 후보: 관리자 API는 `no-store` 유지가 맞다. 공개 API 중 `/api/schedule-today`, `/api/public-overrides`는 CDN cache를 사용한다.
- 이미지 최적화 필요 영역: 방송 썸네일, 멤버 프로필, 공지 프로필, 유튜브 썸네일, 티어 썸네일. 동적 이미지는 `loading="lazy"`, `decoding="async"`, 전역 fallback을 적용한다.
- 트래픽 증가 시 위험 영역: 홈 동시 접속 시 외부 LIVE API와 GitHub raw JSON 요청이 몰릴 수 있다. 오래된 캐시라도 보여주는 stale fallback을 유지한다.

## 캐시 정책

| 데이터 | 기준 TTL | 구현 위치 |
| --- | ---: | --- |
| LIVE 상태 | 45초 | `MonstarzDataServices.live` |
| 오늘 일정 | 3분 | `MonstarzDataServices.scheduleToday`, `/api/schedule-today` |
| 공지 | 3분 | `MonstarzDataServices.notices` |
| 티어/전적 | 5분 | `MonstarzDataServices.tier`, `records` |
| 멤버/프로필 | 30분 | 정적 데이터 service cache |
| 영상/팬튜브/보자충 | 15분 | `MonstarzDataServices.videos` |
| Supabase 공개 override | 2분 | `/api/public-overrides` |
| IN&OUT | 45분 | 정적 데이터 service cache |
| 외부 링크/자료실 | 1시간 | 정적 데이터 service cache |

## 적용 기준

- 같은 cache key의 동시 요청은 in-flight promise를 공유한다.
- 네트워크 실패 시 기존 cache가 있으면 `stale: true`로 반환한다.
- 홈은 요약 데이터만 렌더링하고 상세 화면에서 전체 목록을 사용한다.
- `/api/schedule-today`는 기본적으로 오늘 일정/휴방만 반환하며, 다가오는 월간 일정은 `includeUpcoming=1`일 때만 포함한다.
- 공개 API는 `ok`, `updatedAt`, `source`를 포함하는 응답 형태를 우선한다.

## 이미지 기준

- 동적 카드 이미지에는 `loading="lazy"`와 `decoding="async"`를 적용한다.
- 이미지 오류 시 전역 fallback으로 팀 로고를 표시한다.
- 썸네일 비율은 기존 카드 CSS의 `aspect-ratio`/`object-fit`을 유지한다.
- 다음 단계에서 가능하면 유튜브 썸네일은 `mqdefault`와 `hqdefault`를 화면 크기에 맞춰 분리한다.

## 남은 TODO

- 외부 LIVE API를 자체 serverless proxy로 감싸 CDN/cache shield를 두는 방안 검토.
- GitHub raw JSON을 Vercel API proxy 또는 Supabase public view로 흡수하는 방안 검토.
- Lighthouse/Playwright 기반 모바일 성능 측정 자동화 추가.
