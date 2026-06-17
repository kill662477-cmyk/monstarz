(function () {
  const CACHE_PREFIX = "monstarz-data-cache:";
  const memoryCache = new Map();
  const now = () => Date.now();

  const ttl = {
    live: 45 * 1000,
    notices: 3 * 60 * 1000,
    schedule: 3 * 60 * 1000,
    tier: 5 * 60 * 1000,
    records: 5 * 60 * 1000,
    videos: 15 * 60 * 1000,
    members: 30 * 60 * 1000,
    profile: 30 * 60 * 1000,
    history: 45 * 60 * 1000,
    links: 60 * 60 * 1000,
  };

  /**
   * Data shapes used by this static fanhub.
   * @typedef {{ name:string, userId?:string, race?:string, tier?:string|number, role?:string, status?:string, profileImage?:string, stream?:string, live?:string }} Member
   * @typedef {{ title:string, url?:string, link?:string, thumbnail?:string, publishedAt?:string, sourceName?:string }} VideoItem
   * @typedef {{ stationName?:string, userId?:string, title?:string, content?:string, time?:string, link?:string }} NoticeItem
   * @typedef {{ date:string, events:Array<{ name:string, race?:string, status:string }> }} InoutItem
   * @typedef {{ title:string, note?:string, url?:string, page?:string }} LinkItem
   * @typedef {{ data:any, loading:boolean, error:Error|null, isEmpty:boolean, updatedAt:string, stale?:boolean }} ServiceResult
   */

  function cacheKey(key) {
    return CACHE_PREFIX + key;
  }

  function isEmptyData(data) {
    if (data == null) return true;
    if (Array.isArray(data)) return data.length === 0;
    if (typeof data === "object") return Object.keys(data).length === 0;
    return false;
  }

  function normalizeResult(data, error, stale, updatedAt) {
    return {
      data,
      loading: false,
      error: error || null,
      isEmpty: isEmptyData(data),
      empty: isEmptyData(data),
      updatedAt: updatedAt || new Date().toISOString(),
      stale: Boolean(stale),
    };
  }

  function readStored(key) {
    try {
      const raw = localStorage.getItem(cacheKey(key));
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeStored(key, entry) {
    try {
      localStorage.setItem(cacheKey(key), JSON.stringify(entry));
    } catch (error) {
      // Private browsing or quota errors should never break the fanhub.
    }
  }

  function normalizeList(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (value && typeof value === "object") {
      return Object.keys(value)
        .sort((a, b) => Number(a) - Number(b))
        .map(key => value[key])
        .filter(Boolean);
    }
    return [];
  }

  function toDateValue(value) {
    if (!value) return 0;
    if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
    const raw = String(value).trim();
    if (!raw) return 0;
    const numeric = Number(raw);
    if (/^\d{10,13}$/.test(raw) && Number.isFinite(numeric)) return raw.length === 10 ? numeric * 1000 : numeric;
    const normalized = raw
      .replace(/\./g, "-")
      .replace(/^(\d{2})-(\d{2})-(\d{2})(.*)$/, (_, y, m, d, rest) => `20${y}-${m}-${d}${rest}`);
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function sortLatest(items, fields) {
    const keys = fields || ["publishedAt", "published", "updatedAt", "createdAt", "time", "date"];
    return normalizeList(items).slice().sort((a, b) => {
      const at = Math.max(...keys.map(key => toDateValue(a && a[key])));
      const bt = Math.max(...keys.map(key => toDateValue(b && b[key])));
      return bt - at;
    });
  }

  function sortedHistory(items) {
    return normalizeList(items).slice().sort((a, b) => toDateValue(b.date) - toDateValue(a.date));
  }

  async function fetchJsonCached(key, url, maxAge, options) {
    const opts = options || {};
    const cached = memoryCache.get(key) || readStored(key);
    const useCache = !opts.refresh && cached && now() - cached.time < maxAge;
    if (useCache) {
      memoryCache.set(key, cached);
      return normalizeResult(cached.data, null, false, cached.updatedAt);
    }

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutMs = opts.timeoutMs || 0;
    const timeoutId = controller && timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const response = await fetch(url, {
        cache: opts.cache || "default",
        signal: controller ? controller.signal : undefined,
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      const entry = { time: now(), data, updatedAt: new Date().toISOString() };
      memoryCache.set(key, entry);
      writeStored(key, entry);
      return normalizeResult(data, null, false, entry.updatedAt);
    } catch (error) {
      if (cached) return normalizeResult(cached.data, error, true, cached.updatedAt);
      return normalizeResult(null, error, false, "");
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function fromStatic(key, data, maxAge) {
    const cached = memoryCache.get(key);
    if (cached && now() - cached.time < maxAge) return normalizeResult(cached.data, null, false, cached.updatedAt);
    const entry = { time: now(), data, updatedAt: new Date().toISOString() };
    memoryCache.set(key, entry);
    return normalizeResult(data, null, false, entry.updatedAt);
  }

  function getMembers(list) {
    const rows = normalizeList(list);
    return fromStatic("members:static", rows, ttl.members);
  }

  function getMemberById(list, id) {
    const userId = String(id || "");
    const rows = normalizeList(list);
    return fromStatic("members:static:" + userId, rows.find(item => item && String(item.userId || item.id || "") === userId) || null, ttl.members);
  }

  function getProfileMembers(list) {
    return fromStatic("profile:static", normalizeList(list), ttl.profile);
  }

  function getSchedules(list) {
    return fromStatic("schedule:static", sortLatest(list, ["date", "startAt", "startsAt"]), ttl.schedule);
  }

  function getScheduleToday(url, options) {
    return fetchJsonCached("schedule:today", url, ttl.schedule, { cache: "no-store", ...(options || {}) });
  }

  function getInoutList(list) {
    return fromStatic("inout:static", sortedHistory(list), ttl.history);
  }

  function getLinks(list) {
    return fromStatic("links:static", normalizeList(list), ttl.links);
  }

  function getVideos(list) {
    return fromStatic("videos:static", sortLatest(list, ["publishedAt", "published", "updatedAt", "createdAt"]), ttl.videos);
  }

  async function getRecords(rootUrl, userId, race, options) {
    const safeKey = String((userId || "") + "_" + (race || "")).replace(/[.#$/[\]]/g, "_");
    return fetchJsonCached(
      "records:" + safeKey,
      rootUrl.replace(/\/$/, "") + "/records/" + encodeURIComponent(safeKey) + ".json",
      ttl.records,
      { cache: "no-store", ...(options || {}) }
    );
  }

  async function soopOembed(vodUrl, options) {
    const opts = options || {};
    const width = opts.width || 960;
    const height = opts.height || 540;
    const url = "https://openapi.sooplive.com/oembed/embedinfo?vod_url=" +
      encodeURIComponent(vodUrl) + "&width=" + encodeURIComponent(width) + "&height=" + encodeURIComponent(height);
    return fetchJsonCached("soop-oembed:" + vodUrl + ":" + width + "x" + height, url, ttl.videos, opts);
  }

  // ===== Phase 4: admin write functions (NOT implemented yet) =====
  // 인증/권한 분리 후 다음 패치에서 연결한다. 현재 관리자 UI는 읽기 전용이며
  // 아래 함수들은 placeholder 단계로만 둔다 (실제 DB 쓰기 금지).
  // TODO: admin createMember
  // TODO: admin updateMember
  // TODO: admin hideMember
  // TODO: admin createSchedule
  // TODO: admin updateSchedule
  // TODO: admin deleteSchedule
  // TODO: admin registerVideo
  // TODO: admin hideVideo
  // TODO: admin hideNotice
  // TODO: admin pinNotice
  // TODO: admin createInout
  // TODO: admin updateInout
  // TODO: admin updateLink
  // TODO: admin updateLinks

  window.MonstarzDataServices = {
    ttl,
    normalizeResult,
    normalizeList,
    sortLatest,
    fetchJsonCached,
    members: getMembers,
    getMembers,
    getMemberById,
    profile: getProfileMembers,
    getProfileMembers,
    schedule: getSchedules,
    getSchedules,
    scheduleToday: getScheduleToday,
    getScheduleToday,
    history: getInoutList,
    inout: getInoutList,
    getInoutList,
    links: getLinks,
    getLinks,
    getVideos,
    videos: (key, url, options) => fetchJsonCached("videos:" + key, url, ttl.videos, options),
    notices: (url, options) => fetchJsonCached("notices", url, ttl.notices, options),
    live: (url, options) => fetchJsonCached("live", url, ttl.live, { cache: "no-store", ...(options || {}) }),
    tier: (key, url, options) => fetchJsonCached("tier:" + key, url, ttl.tier, options),
    records: getRecords,
    soopOembed,
  };
})();
