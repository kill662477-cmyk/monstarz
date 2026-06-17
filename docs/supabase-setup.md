# Supabase 연결 가이드 (MONSTARZNEW)

이 문서는 **아직 Supabase 프로젝트가 없는 상태**에서, 직접 프로젝트를 만들고
환경변수를 넣어 관리자 기능을 연결하기까지의 순서를 안내합니다.

> 중요: Supabase를 연결하지 않아도 사이트(홈/현황판/프로필/티어표/일정/영상/IN&OUT/
> 핀볼/펀딩/덕몽 계산기/오락실/외부 링크)는 기존 Firebase·JSON·외부 API fallback으로
> **그대로 정상 동작**합니다. Supabase는 "관리자가 직접 고치는 데이터"를 위한 추가 계층입니다.

---

## 1. Supabase 프로젝트 만들기 (직접 해야 하는 작업)

1. https://supabase.com 접속 후 로그인
2. **New project** 클릭
3. **Project name**: 예) `monstarznew`
4. **Region**: 한국 사용자가 많으면 `Northeast Asia (Seoul)` 또는 `Singapore`
5. **Database Password**: 강력한 비밀번호 생성 후 **안전한 곳에 저장** (분실 시 재설정 필요)
6. **Create new project** 클릭 → 프로비저닝 완료까지 1~2분 대기
7. 프로젝트가 열리면 좌측 **Project Settings → API** (또는 상단 **Connect**) 로 이동
8. 아래 값들을 확보합니다.

### 확보할 환경변수

| 환경변수 | 어디서 | 노출 여부 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | 공개 가능 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` 또는 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | anon / publishable key | 공개 가능 |
| `SUPABASE_SERVICE_ROLE_KEY` 또는 `SUPABASE_SECRET_KEY` | service_role / secret key | **절대 비공개** |
| `ADMIN_SECRET` | 직접 정하는 임의의 긴 문자열 | **절대 비공개** |

> 새 Supabase 콘솔은 `anon`/`service_role` 대신 `publishable`/`secret` 이라는 이름을 쓸 수 있습니다.
> 어느 쪽이든 한 쌍만 있으면 됩니다. 코드가 두 이름 모두 인식합니다.

---

## 2. 데이터베이스 스키마 만들기

1. Supabase 좌측 **SQL Editor** → **New query**
2. 저장소의 [`supabase/migrations/0001_initial_admin_tables.sql`](../supabase/migrations/0001_initial_admin_tables.sql) 내용을 전체 복사해 붙여넣기
3. **Run** 실행
4. 9개 테이블(`members_admin`, `schedules`, `videos`, `notices_meta`, `inout_events`,
   `external_links`, `resources`, `weekly_best_manual`, `monthly_reports`)과 RLS 정책이 생성됩니다.

이 SQL은 여러 번 실행해도 안전합니다(IF NOT EXISTS 사용). RLS가 켜져 있어
공개 키로는 `is_visible = true` 행만 읽을 수 있고, **쓰기는 서버 API에서 service 키로만** 가능합니다.

---

## 3. 로컬 환경변수 설정 (`.env.local`)

저장소 루트에 `.env.local` 파일을 만들고 [`.env.example`](../.env.example) 를 참고해 채웁니다.

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...        # 또는 PUBLISHABLE 키
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...            # 또는 SUPABASE_SECRET_KEY
ADMIN_SECRET=직접-정한-긴-비밀-문자열
```

> `.env.local` 은 `.gitignore` 에 들어 있어 커밋되지 않습니다. 절대 커밋하지 마세요.

---

## 4. Vercel 환경변수 설정

Vercel → 프로젝트 → **Settings → Environment Variables** 에서 위 값들을 추가합니다.

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (또는 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`)
- `SUPABASE_SERVICE_ROLE_KEY` (또는 `SUPABASE_SECRET_KEY`)
- `ADMIN_SECRET`

적용 환경: **Production** / **Preview** (필요하면 **Development**) 모두 체크.

> 보안 주의
> - `NEXT_PUBLIC_*` 값만 브라우저에 노출됩니다(공개용, RLS 보호).
> - `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` / `ADMIN_SECRET` 은 **서버 전용**입니다.
>   이 값들은 서버리스 함수(`api/`)에서만 읽히며 브라우저 번들에 절대 포함되지 않습니다.

---

## 5. 데이터 이전(선택) — import 스크립트

기존 하드코딩/JSON 데이터를 Supabase로 옮기려면 import 스크립트를 사용합니다.
모두 `--dry-run`(미적용 미리보기)을 먼저 돌려보고 `--apply`로 실제 반영합니다.
환경변수(`SUPABASE_URL` + service 키)가 없으면 스크립트는 즉시 중단됩니다.

```bash
# 미리보기 (DB에 쓰지 않음)
node scripts/import-supabase-links.js --dry-run

# 실제 반영 (upsert, 중복 방지)
node scripts/import-supabase-links.js --apply
```

사용 가능한 스크립트:

- `scripts/import-supabase-members.js`
- `scripts/import-supabase-schedules.js`
- `scripts/import-supabase-links.js`
- `scripts/import-supabase-inout.js`
- `scripts/import-supabase-videos.js`

> 로컬에서 스크립트를 돌릴 때는 `.env.local` 의 값을 셸 환경변수로 넘겨야 합니다. 예:
> `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-supabase-links.js --dry-run`

---

## 6. 연결 확인 체크리스트

1. [ ] Supabase 프로젝트 생성
2. [ ] SQL Editor에서 `supabase/migrations/0001_initial_admin_tables.sql` 실행
3. [ ] Project Settings/API 에서 URL과 key 확인
4. [ ] 로컬 `.env.local` 작성
5. [ ] Vercel Project Settings 에 환경변수 추가 (Production/Preview)
6. [ ] 로컬에서 정적 검사/배포 후 사이트 정상 확인
7. [ ] 배포본에서 `/admin` (모바일은 `/mobile/#admin`) 접속
8. [ ] 관리자 코드(`ADMIN_SECRET`) 입력 → 로그인
9. [ ] 링크/일정 등 데이터 추가·숨김 테스트
10. [ ] 공개 페이지에 반영되는지 확인

---

## 7. 동작 방식 요약 (fallback 우선순위)

| 상태 | 공개 페이지 데이터 |
|---|---|
| Supabase 연결됨 + 데이터 있음 | Supabase 데이터 사용 |
| Supabase 연결됨 + 데이터 없음 | 기존 Firebase/JSON fallback |
| Supabase 미연결 | 기존 Firebase/JSON fallback |
| Supabase 오류 | 오류 표시 후 가능하면 기존 fallback |

> 티어/전적(ELO), 방송중 LIVE, 자동 수집 파이프라인은 이번 단계에서 Supabase로 옮기지 않고
> 기존 구조를 그대로 유지합니다.

---

## 8. 아직 남은 작업 (다음 패치)

- Supabase Auth 기반 정식 관리자 로그인 (현재는 `ADMIN_SECRET` + httpOnly 쿠키 임시 보호)
- 관리자 UI의 추가/수정 입력 폼 전체 연결 (현재 골격 + 숨김/고정/정렬 위주)
- 자료실/주간베스트/월간결산 공개 화면 노출
