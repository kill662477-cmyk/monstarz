// 서버 전용 Supabase 설정 리더. 브라우저에서 import/사용 금지.
// 환경변수가 없어도 throw 하지 않고 ready:false 를 돌려줘 빌드/구동이 안전하게 유지됩니다.

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

// 서버 전용(쓰기) 설정: service_role / secret 키
function getServerConfig() {
  const url = stripTrailingSlash(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ""
  );
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
  return { url, serviceKey, ready: Boolean(url && serviceKey) };
}

// 공개(읽기) 설정: anon / publishable 키 (브라우저로 내려줘도 되는 값)
function getPublicConfig() {
  const url = stripTrailingSlash(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ""
  );
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    "";
  return { url, anonKey, ready: Boolean(url && anonKey) };
}

module.exports = { getServerConfig, getPublicConfig };
