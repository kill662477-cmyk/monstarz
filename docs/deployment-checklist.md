# 배포 체크리스트

## 배포 전

- `npm run build` 성공
- `git diff --check` 통과
- `node --check` 대상 API/서비스 파일 통과
- `index.html`, `mobile/index.html` 기본 로딩 확인
- `manifest.webmanifest`, `mobile/manifest.webmanifest` JSON 파싱 확인
- `robots.txt`, `sitemap.xml` 도메인 확인
- `assets/og-default.png`, `assets/icon-192.png`, `assets/icon-512.png` 존재 확인

## 환경변수

- Supabase URL/public key/server key 설정 여부 확인
- Firebase Admin 관련 환경변수 확인
- `ADMIN_SECRET` 설정 여부 확인
- SOOP OAuth 관련 설정 확인
- GitHub Actions secrets 누락 여부 확인

## 배포 후

- `/` PC 홈 정상 표시
- `/mobile/` 모바일 홈 정상 표시
- `/api/public-overrides` 응답 확인
- `/api/schedule-today` 오늘 일정 응답 확인
- `/api/admin/auth/status` 응답 확인
- LIVE, 공지, 영상, 티어표, IN&OUT fallback 확인
- 핀볼연동, 펀딩, 덕몽어스 계산기, 오락실 접근 확인
- 관리자 데이터 상태 화면 권한/미연결 안내 확인
- 404 페이지 확인
- favicon, manifest, OG 이미지 확인
- 외부 링크 `target="_blank"`와 `rel="noopener noreferrer"` 확인
- secret 값이 화면, 로그, 문서에 노출되지 않았는지 확인

## 알려진 주의점

- 단일 페이지 탭 구조라 검색엔진은 정적 루트와 모바일 루트를 우선 인덱싱한다.
- 관리자/방송도구 일부는 탭 전환 시 `noindex` 메타를 적용한다.
- 공개 데이터는 서비스 레이어 캐시와 서버리스 응답 캐시가 같이 적용될 수 있다.
