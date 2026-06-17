// 관리자 API (catch-all). 모든 /api/admin/* 요청을 하나의 서버리스 함수로 처리합니다.
// (Vercel Hobby 함수 개수 제한 대응)
//
// 보안:
//  - 쓰기/조회는 ADMIN_SECRET 으로 발급한 httpOnly 쿠키가 있어야 동작
//  - Supabase 쓰기는 서버 전용 service/secret 키로만 (lib/supabase/admin.js)
//  - service 키 / ADMIN_SECRET 은 절대 응답 본문이나 브라우저로 노출하지 않음
//  - 실제 삭제 없음(soft delete: is_visible=false, hidden_at)
//
// 라우트(논리):
//  POST   /api/admin/auth/login      { code }      -> 쿠키 발급
//  POST   /api/admin/auth/logout                   -> 쿠키 삭제
//  GET    /api/admin/auth/status                   -> 로그인 여부 + supabase 연결 여부
//  GET    /api/admin/<resource>                    -> 목록(숨김 포함)
//  POST   /api/admin/<resource>      { ...fields } -> 추가
//  PATCH  /api/admin/<resource>/:id  { ...fields } -> 수정
//  PATCH  /api/admin/<resource>/:id/hide           -> 숨김(soft delete)
//  PATCH  /api/admin/<resource>/:id/restore        -> 복구
//  PATCH  /api/admin/notices/:id/pin { pinned }    -> 고정 토글
//  PATCH  /api/admin/videos/:id/pin  { pinned }    -> 고정 토글
//  PATCH  /api/admin/links/reorder   { orders:[{id,sort_order}] } -> 정렬

const crypto = require("crypto");
const { getServerConfig, getPublicConfig } = require("../../lib/supabase/server");
const admin = require("../../lib/supabase/admin");

const COOKIE_NAME = "mz_admin";

const RESOURCES = {
  members: { table: "members_admin" },
  schedules: { table: "schedules" },
  videos: { table: "videos" },
  notices: { table: "notices_meta" },
  inout: { table: "inout_events" },
  links: { table: "external_links" },
  resources: { table: "resources" }
};

// 입력으로 받을 수 있는 컬럼 화이트리스트 (그 외 키는 무시)
const FIELD_WHITELIST = {
  members_admin: ["member_code", "name", "race", "tier", "role", "soop_id", "youtube_url", "profile_image", "sort_order", "is_visible"],
  schedules: ["title", "start_at", "end_at", "event_date", "description", "members", "status", "sort_order", "is_visible"],
  videos: ["title", "platform", "member_code", "url", "published_at", "thumbnail", "is_pinned", "sort_order", "is_visible"],
  notices_meta: ["source_key", "title", "station_name", "link", "notice_date", "is_pinned", "sort_order", "is_visible"],
  inout_events: ["member_name", "event_type", "event_date", "race", "description", "sort_order", "is_visible"],
  external_links: ["title", "url", "category", "note", "sort_order", "is_visible"],
  resources: ["title", "url", "category", "description", "sort_order", "is_visible"]
};

function expectedToken() {
  const secret = process.env.ADMIN_SECRET || "";
  if (!secret) return "";
  return crypto.createHash("sha256").update("mz::" + secret).digest("hex");
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach(function (part) {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function isAuthed(req) {
  const expected = expectedToken();
  if (!expected) return false; // ADMIN_SECRET 미설정이면 항상 비인증
  const token = parseCookies(req)[COOKIE_NAME] || "";
  return timingSafeEqual(token, expected);
}

function setAuthCookie(res, value, maxAgeSec) {
  const parts = [
    COOKIE_NAME + "=" + value,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
    "Max-Age=" + maxAgeSec
  ];
  res.setHeader("Set-Cookie", parts.join("; "));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body || "{}"); } catch (e) { return {}; }
  }
  // 스트림 직접 파싱 (일부 런타임)
  return await new Promise(function (resolve) {
    let raw = "";
    req.on("data", function (c) { raw += c; });
    req.on("end", function () {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { resolve({}); }
    });
    req.on("error", function () { resolve({}); });
  });
}

function pickFields(table, body) {
  const allow = FIELD_WHITELIST[table] || [];
  const out = {};
  allow.forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined) out[k] = body[k];
  });
  return out;
}

function ok(res, data) {
  return res.status(200).json({ ok: true, data: data === undefined ? null : data });
}
function fail(res, status, error, message) {
  return res.status(status).json({ ok: false, error: error, message: message || error });
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const segments = []
    .concat(req.query && req.query.path ? req.query.path : [])
    .map(function (s) { return String(s); });

  const method = req.method;

  // ---- auth ----
  if (segments[0] === "auth") {
    const action = segments[1] || "status";

    if (action === "status" && method === "GET") {
      return res.status(200).json({
        ok: true,
        authed: isAuthed(req),
        adminConfigured: Boolean(process.env.ADMIN_SECRET),
        supabaseReady: getServerConfig().ready,
        supabasePublicReady: getPublicConfig().ready
      });
    }

    if (action === "login" && method === "POST") {
      if (!process.env.ADMIN_SECRET) return fail(res, 503, "admin_not_configured", "ADMIN_SECRET 환경변수가 설정되지 않았습니다.");
      const body = await readJsonBody(req);
      const code = (body && body.code) || "";
      if (!timingSafeEqual(code, process.env.ADMIN_SECRET)) return fail(res, 401, "invalid_code", "관리자 코드가 올바르지 않습니다.");
      setAuthCookie(res, expectedToken(), 60 * 60 * 8); // 8시간
      return ok(res, { authed: true });
    }

    if (action === "logout" && method === "POST") {
      setAuthCookie(res, "", 0);
      return ok(res, { authed: false });
    }

    return fail(res, 405, "method_not_allowed");
  }

  // ---- 이하 모든 리소스 작업은 인증 필요 ----
  if (!isAuthed(req)) return fail(res, 401, "unauthorized", "관리자 인증이 필요합니다.");

  const resourceKey = segments[0];
  const resource = RESOURCES[resourceKey];

  // links/reorder
  if (resourceKey === "links" && segments[1] === "reorder" && method === "PATCH") {
    try {
      const body = await readJsonBody(req);
      const orders = Array.isArray(body.orders) ? body.orders : [];
      const results = [];
      for (let i = 0; i < orders.length; i++) {
        const item = orders[i];
        if (!item || !item.id) continue;
        results.push(await admin.updateRow("external_links", item.id, { sort_order: Number(item.sort_order) || 0 }));
      }
      return ok(res, { updated: results.length });
    } catch (e) {
      return handleError(res, e);
    }
  }

  // 자동화 실행 로그 조회 (읽기 전용)
  if (resourceKey === "automation" && method === "GET") {
    try {
      const data = await admin.rest("GET", "automation_runs", { query: "?select=*&order=created_at.desc&limit=30" });
      return ok(res, data);
    } catch (e) {
      return handleError(res, e);
    }
  }

  if (!resource) return fail(res, 404, "not_found", "알 수 없는 리소스입니다.");
  const table = resource.table;
  const id = segments[1];
  const subAction = segments[2];

  try {
    // GET /admin/<resource>
    if (method === "GET" && !id) {
      const data = await admin.adminSelect(table, { includeHidden: true });
      return ok(res, data);
    }

    // POST /admin/<resource>
    if (method === "POST" && !id) {
      const body = await readJsonBody(req);
      const payload = pickFields(table, body);
      if (!Object.keys(payload).length) return fail(res, 400, "empty_payload", "저장할 값이 없습니다.");
      const data = await admin.insertRow(table, payload);
      return ok(res, data);
    }

    // PATCH /admin/<resource>/:id ...
    if (method === "PATCH" && id) {
      if (subAction === "hide") {
        return ok(res, await admin.softDelete(table, id));
      }
      if (subAction === "restore") {
        return ok(res, await admin.restore(table, id));
      }
      if (subAction === "pin") {
        const body = await readJsonBody(req);
        const pinned = body && typeof body.pinned === "boolean" ? body.pinned : true;
        return ok(res, await admin.updateRow(table, id, { is_pinned: pinned }));
      }
      // 일반 수정
      const body = await readJsonBody(req);
      const payload = pickFields(table, body);
      if (!Object.keys(payload).length) return fail(res, 400, "empty_payload", "수정할 값이 없습니다.");
      return ok(res, await admin.updateRow(table, id, payload));
    }

    return fail(res, 405, "method_not_allowed");
  } catch (e) {
    return handleError(res, e);
  }
};

function handleError(res, e) {
  if (e && e.code === "supabase_not_configured") {
    return fail(res, 503, "supabase_not_configured", "Supabase 환경변수가 설정되지 않았습니다.");
  }
  return fail(res, (e && e.status) || 500, "server_error", (e && e.message) || "server_error");
}
