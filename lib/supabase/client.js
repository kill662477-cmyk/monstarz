/* 브라우저 공개 읽기용 Supabase 클라이언트 (null-safe).
   - 빌드 단계가 없는 정적 사이트이므로 npm 패키지 대신 PostgREST REST 를 fetch 합니다.
   - 공개 URL/anon 키는 서버리스 /api/supabase-config 에서 받아옵니다.
   - 환경변수가 없으면 available:false 를 돌려줘 기존 fallback 으로 이어집니다.
   window.MonstarzSupabase 로 노출. */
(function () {
  var state = { loaded: false, url: "", anonKey: "", available: false };
  var loadPromise = null;

  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = fetch("/api/supabase-config", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        state.loaded = true;
        if (cfg && cfg.url && cfg.anonKey) {
          state.url = String(cfg.url).replace(/\/+$/, "");
          state.anonKey = cfg.anonKey;
          state.available = true;
        }
        return state;
      })
      .catch(function () {
        state.loaded = true;
        state.available = false;
        return state;
      });
    return loadPromise;
  }

  // 허용된 정렬 컬럼만 통과시켜 잘못된 입력으로 인한 오류를 막습니다.
  function safeOrder(order) {
    return /^[a-z_]+\.(asc|desc)$/.test(String(order || "")) ? order : "sort_order.asc";
  }

  // 공개(is_visible=true) 행만 읽습니다. 반환: {available, data, error}
  function select(table, opts) {
    opts = opts || {};
    var t = String(table || "").replace(/[^a-z_]/g, "");
    return load().then(function (s) {
      if (!s.available || !t) return { available: false, data: null };
      var url =
        s.url + "/rest/v1/" + t +
        "?select=*&is_visible=eq.true&order=" + safeOrder(opts.order);
      return fetch(url, {
        headers: { apikey: s.anonKey, Authorization: "Bearer " + s.anonKey }
      })
        .then(function (r) {
          if (!r.ok) throw new Error("supabase_read_error_" + r.status);
          return r.json();
        })
        .then(function (data) { return { available: true, data: data }; })
        .catch(function (err) { return { available: true, error: err, data: null }; });
    });
  }

  window.MonstarzSupabase = {
    load: load,
    select: select,
    isAvailable: function () { return state.available; },
    state: state
  };
})();
