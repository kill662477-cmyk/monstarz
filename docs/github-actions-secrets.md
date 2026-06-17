# GitHub Actions Secrets (MONSTARZNEW)

자동 수집 워크플로우에서 사용하는 secrets 의 **이름과 용도만** 정리합니다.
**실제 값은 절대 이 문서/코드/로그에 적지 마세요.** GitHub → Settings → Secrets and variables → Actions 에 등록합니다.

| Secret 이름 | 용도 | 사용 주체 | 비고 |
|---|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin 인증(JSON) | ELO/전적, Live 동기화 | 기존 유지 |
| `FIREBASE_DATABASE_URL` | Firebase RTDB URL | 동일 | 기본값 코드에 있음, secret 권장 |
| `SUPABASE_URL` | Supabase 프로젝트 URL | 자동화 로그/보조 저장 | 공개값이지만 secret 로 통일 가능 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 서버 쓰기 키 | `automation_runs` 기록, 보조 저장 | **서버 전용, 절대 노출 금지** |
| `YOUTUBE_API_KEY` | 유튜브 수집 | 영상 수집 워크플로우 | 사용 중이면 등록 |
| `SOOP_CLIENT_ID` / `SOOP_CLIENT_SECRET` / `SOOP_REDIRECT_URI` | SOOP OpenAPI 토큰 | (Vercel `api/soop-token.js` 에서도 사용) | 필요 시 |

## 원칙
- `ADMIN_SECRET` 은 관리자 웹 로그인용이라 **Actions 에는 보통 불필요**. 꼭 필요하지 않으면 Actions secret 으로 넣지 마세요.
- secret 값을 `echo` 하거나 로그로 출력하지 마세요. GitHub Actions 는 등록된 secret 을 로그에서 자동 마스킹하지만, 가공된 값은 마스킹되지 않을 수 있습니다.
- `NEXT_PUBLIC_*` 접두사는 브라우저 노출용이므로 service/secret 키에 **절대 사용하지 마세요**.
- 키가 노출되었다고 의심되면 즉시 해당 콘솔(Firebase/Supabase/Google)에서 **재발급(rotate)** 하세요.
