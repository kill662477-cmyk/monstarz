# GitHub Actions Secrets (MONSTARZNEW)

자동 수집 워크플로우에서 필요한 secret의 이름과 용도만 정리합니다. 실제 값은 절대 코드, 문서, 로그에 남기지 마세요.

| Secret 이름 | 용도 | 사용 workflow | 비고 |
|---|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Admin 인증 JSON | `collect-tier`, `sync-live`, `export-manual-players` | 현재 workflow에서 사용하는 이름 |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin 인증 JSON | 예비/레거시 이름 | 사용 중인 workflow가 있으면 둘 중 하나로 통일 검토 |
| `FIREBASE_DATABASE_URL` | Firebase RTDB URL | Firebase 쓰기/읽기 작업 | 기본값이 있어도 secret 등록 권장 |
| `SOOP_CLIENT_ID` | SOOP OpenAPI broad/list 호출 | `sync-live` | LIVE 동기화용 |
| `SUPABASE_URL` | Supabase 프로젝트 URL | 자동화 로그/보조 저장 | 공개 URL이지만 Actions에서는 secret/variable로 관리 가능 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | `automation_runs` 기록 | 서버 전용, 브라우저 노출 금지 |
| `YOUTUBE_API_KEY` | 향후 YouTube 수집 | 영상 수집 workflow 추가 시 | 현재 핵심 workflow에는 미사용 |

## 보안 원칙

- secret 값을 `echo`, 디버그 로그, artifact에 출력하지 않습니다.
- `NEXT_PUBLIC_*` 이름은 브라우저 노출용입니다. service role/private key에는 절대 사용하지 않습니다.
- `ADMIN_SECRET`은 웹 관리자 로그인용입니다. Actions에서 꼭 필요하지 않으면 등록하지 않습니다.
- 키 노출이 의심되면 Firebase/Supabase/Google 콘솔에서 즉시 rotate합니다.
