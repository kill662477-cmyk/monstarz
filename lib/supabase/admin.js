// 서버 전용 Supabase 관리(쓰기) 헬퍼. API route 에서만 require 하세요.
// service_role/secret 키로 REST(PostgREST) 호출합니다. 별도 npm 의존성 없이 fetch 사용.
// 환경변수가 없으면 SupabaseConfigError 를 던져 호출부가 명확한 메시지를 반환하게 합니다.

const { getServerConfig } = require("./server");

class SupabaseConfigError extends Error {
  constructor(message) {
    super(message || "Supabase 환경변수가 설정되지 않았습니다.");
    this.name = "SupabaseConfigError";
    this.code = "supabase_not_configured";
    this.status = 503;
  }
}

function ensureConfig() {
  const cfg = getServerConfig();
  if (!cfg.ready) throw new SupabaseConfigError();
  return cfg;
}

async function rest(method, table, options) {
  options = options || {};
  const cfg = ensureConfig();
  const headers = {
    apikey: cfg.serviceKey,
    Authorization: "Bearer " + cfg.serviceKey,
    "Content-Type": "application/json"
  };
  if (options.prefer) headers.Prefer = options.prefer;
  const res = await fetch(cfg.url + "/rest/v1/" + table + (options.query || ""), {
    method: method,
    headers: headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = text;
  }
  if (!res.ok) {
    const err = new Error((data && data.message) || "supabase_request_failed");
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

// 관리자 목록 조회: 기본적으로 숨김 포함(관리자는 전체를 봄)
async function adminSelect(table, opts) {
  opts = opts || {};
  const order = opts.order || "sort_order.asc";
  const vis = opts.includeHidden === false ? "&is_visible=eq.true" : "";
  return rest("GET", table, { query: "?select=*&order=" + order + vis });
}

async function insertRow(table, payload) {
  return rest("POST", table, { body: payload, prefer: "return=representation" });
}

async function updateRow(table, id, payload) {
  const body = Object.assign({}, payload, { updated_at: new Date().toISOString() });
  return rest("PATCH", table, {
    query: "?id=eq." + encodeURIComponent(id),
    body: body,
    prefer: "return=representation"
  });
}

// 실제 삭제 대신 소프트 삭제
async function softDelete(table, id) {
  return updateRow(table, id, { is_visible: false, hidden_at: new Date().toISOString() });
}

async function restore(table, id) {
  return updateRow(table, id, { is_visible: true, hidden_at: null });
}

module.exports = {
  rest,
  adminSelect,
  insertRow,
  updateRow,
  softDelete,
  restore,
  ensureConfig,
  SupabaseConfigError
};
