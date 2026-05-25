const fs = require("fs/promises");
const path = require("path");
const admin = require("firebase-admin");

const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "data");
const recordDir = path.join(dataDir, "records");
const assetDir = path.join(root, "assets");
const profileDir = path.join(assetDir, "profile");
const academyDir = path.join(assetDir, "academy");

const FIREBASE_DATABASE_URL =
  process.env.FIREBASE_DATABASE_URL ||
  "https://jddcontens-default-rtdb.asia-southeast1.firebasedatabase.app";

const FIREBASE_ROOT = process.env.FIREBASE_ROOT || "starcraftTier/current";

const FETCH_TIMEOUT_MS = Math.max(3000, Number(process.env.FETCH_TIMEOUT_MS || 15000));
const RECORD_CONCURRENCY = Math.max(1, Number(process.env.RECORD_CONCURRENCY || 3));
const RECORD_MAX_PAGES = Math.max(1, Number(process.env.RECORD_MAX_PAGES || 30));

const CACHE_LOCAL_JSON = process.env.CACHE_LOCAL_JSON !== "false";
const CACHE_LOCAL_ASSETS = process.env.CACHE_LOCAL_ASSETS === "true";

const tierName = {
  G: "갓티어",
  K: "킹티어",
  J: "잭티어",
  O: "조커티어",
  S: "스페이드티어",
  B: "베이비티어",
  N: "티어없음",
};

const tierOrder = [
  "G",
  "K",
  "J",
  "O",
  "S",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "B",
  "N",
];

const headPeriods = ["ALL", "LAST_1_MONTHS", "LAST_2_MONTHS", "LAST_3_MONTHS"];

function normalizeUrl(url) {
  if (!url) return "";
  const value = String(url);
  if (value.startsWith("//")) return `https:${value}`;
  return value;
}

function safeKey(value) {
  return String(value || "").replace(/[.#$\/\[\]]/g, "_");
}

function localPath(file) {
  return file.split(path.sep).join("/");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function eloboardUrl(key, race) {
  if (!key) return "";

  const matched = String(key)
    .split(",")
    .find((item) => item.split("_")[2] === race);

  if (!matched) return "";

  const [type, id] = matched.split("_");

  if (type === "W") {
    return `https://eloboard.com/women/bbs/board.php?bo_table=bj_list&wr_id=${id}`;
  }

  if (type === "M") {
    return `https://eloboard.com/women/bbs/board.php?bo_table=bj_m_list&wr_id=${id}`;
  }

  if (type === "P") {
    return `https://eloboard.com/men/bbs/board.php?bo_table=bj_list&wr_id=${id}`;
  }

  return "";
}

async function fetchBodyWithTimeout(url, options = {}, readBody) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    const body = readBody ? await readBody(response) : null;

    return {
      response,
      body,
    };
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(`timeout after ${FETCH_TIMEOUT_MS}ms: ${url}`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url) {
  const { response, body } = await fetchBodyWithTimeout(
    url,
    {
      headers: {
        "user-agent": "Mozilla/5.0",
        accept: "application/json,text/plain,*/*",
      },
    },
    (res) => res.text()
  );

  if (!response.ok) {
    throw new Error(`${response.status} ${url}`);
  }

  if (!body) return null;

  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`JSON parse failed: ${url}`);
  }
}

async function getText(url) {
  const { response, body } = await fetchBodyWithTimeout(
    url,
    {
      headers: {
        "user-agent": "Mozilla/5.0",
      },
    },
    (res) => res.text()
  );

  return {
    status: response.status,
    text: body || "",
  };
}

async function download(url, target) {
  const fullUrl = normalizeUrl(url);
  if (!fullUrl) return false;

  const { response, body } = await fetchBodyWithTimeout(
    fullUrl,
    {
      headers: {
        "user-agent": "Mozilla/5.0",
      },
    },
    (res) => res.arrayBuffer()
  );

  if (!response.ok || !body) return false;

  await fs.writeFile(target, Buffer.from(body));
  return true;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  const runners = Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

async function fetchRecords(player) {
  if (!player.eloboardKey) return [];

  const rows = [];
  let page = 1;
  let total = 0;

  while (page <= RECORD_MAX_PAGES) {
    const params = new URLSearchParams({
      soopUserId: player.userId,
      race: player.race,
      page: String(page),
      size: "1000",
      orderBy: "id",
      order: "desc",
    });

    const url = `https://www.cnine.kr/api/v2/p/starcraft/eloboard?${params}`;
    const result = await getJson(url);

    const pageRows = Array.isArray(result && result.data) ? result.data : [];

    rows.push(...pageRows);

    total = Number((result && result.total) || rows.length || 0);

    if (pageRows.length === 0) break;
    if (rows.length >= total) break;

    page += 1;

    await sleep(80);
  }

  return rows;
}

function rowDate(row) {
  return String(
    row.date ||
      row.standardDate ||
      row.playedAt ||
      row.createdAt ||
      row.updatedAt ||
      row.matchDate ||
      ""
  ).slice(0, 10);
}

function rowWinnerId(row) {
  return String(
    row.winnerSoopUserId ||
      row.winnerUserId ||
      row.winnerId ||
      row.winner ||
      row.winSoopUserId ||
      row.winUserId ||
      ""
  );
}

function rowLoserId(row) {
  return String(
    row.loseSoopUserId ||
      row.loserSoopUserId ||
      row.loseUserId ||
      row.loserUserId ||
      row.loserId ||
      row.loseId ||
      row.loser ||
      ""
  );
}

function rowWinnerName(row) {
  return String(row.winnerPlayer || row.winnerName || row.winPlayer || row.winName || "");
}

function rowLoserName(row) {
  return String(row.losePlayer || row.loserPlayer || row.loseName || row.loserName || "");
}

function rowWinnerRace(row) {
  return String(row.winnerRace || row.winRace || "");
}

function rowLoserRace(row) {
  return String(row.loseRace || row.loserRace || "");
}

function rowOpponentName(row, userId) {
  const winnerId = rowWinnerId(row);
  const loserId = rowLoserId(row);

  if (winnerId && winnerId === String(userId)) {
    return rowLoserName(row) || row.opponentName || "";
  }

  if (loserId && loserId === String(userId)) {
    return rowWinnerName(row) || row.opponentName || "";
  }

  return row.opponentName || "";
}

function rowOpponentRace(row, userId) {
  const winnerId = rowWinnerId(row);
  const loserId = rowLoserId(row);

  if (winnerId && winnerId === String(userId)) {
    return rowLoserRace(row) || row.opponentRace || "";
  }

  if (loserId && loserId === String(userId)) {
    return rowWinnerRace(row) || row.opponentRace || "";
  }

  return row.opponentRace || "";
}

function rowOpponentId(row, userId) {
  const winnerId = rowWinnerId(row);
  const loserId = rowLoserId(row);

  if (winnerId && winnerId === String(userId)) return loserId;
  if (loserId && loserId === String(userId)) return winnerId;

  return String(row.opponentSoopUserId || row.opponentUserId || "");
}

function rowIsWin(row, userId) {
  const winnerId = rowWinnerId(row);
  const loserId = rowLoserId(row);

  if (winnerId) {
    return winnerId === String(userId);
  }

  if (loserId) {
    return loserId !== String(userId);
  }

  const result = String(row.result || row.win || row.status || "").toLowerCase();

  return result === "win" || result === "w" || row.isWin === true;
}

function parseDateMonth(value) {
  const text = String(value || "").slice(0, 10);
  const match = /^(\d{4})-(\d{2})/.exec(text);

  if (!match) return null;

  return {
    year: Number(match[1]),
    month: Number(match[2]),
  };
}

function periodIncludes(dateValue, period, now = new Date()) {
  if (period === "ALL") return true;

  const match = /^LAST_(\d+)_MONTHS$/.exec(period);
  if (!match) return true;

  const limit = Number(match[1]);
  const parsed = parseDateMonth(dateValue);

  if (!parsed) return false;

  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth() + 1;
  const diff = (nowYear - parsed.year) * 12 + (nowMonth - parsed.month);

  return diff >= 0 && diff < limit;
}

function headToHeadKey(player, opponent, period) {
  return safeKey(
    [player.userId, player.race, opponent.userId, opponent.race, period].join("_")
  );
}

function buildHeadToHead(players, records) {
  const headToHead = {};
  const byUserRace = new Map();
  const byUserOnly = new Map();
  const byNameRace = new Map();

  players.forEach((player) => {
    byUserRace.set(`${player.userId}_${player.race}`, player);
    byUserOnly.set(String(player.userId), player);

    const nameRaceKey = `${player.name}_${player.race}`;
    if (!byNameRace.has(nameRaceKey)) {
      byNameRace.set(nameRaceKey, []);
    }

    byNameRace.get(nameRaceKey).push(player);
  });

  function findOpponent(row, player) {
    const opponentId = rowOpponentId(row, player.userId);
    const opponentRace = rowOpponentRace(row, player.userId);
    const opponentName = rowOpponentName(row, player.userId);

    if (opponentId && opponentRace) {
      const exact = byUserRace.get(`${opponentId}_${opponentRace}`);
      if (exact) return exact;

      return {
        userId: opponentId,
        race: opponentRace,
        name: opponentName || opponentId,
      };
    }

    if (opponentId) {
      const byUser = byUserOnly.get(opponentId);
      if (byUser) return byUser;
    }

    if (opponentName && opponentRace) {
      const candidates = byNameRace.get(`${opponentName}_${opponentRace}`) || [];
      if (candidates.length === 1) return candidates[0];
    }

    return null;
  }

  function addScore(player, opponent, period, isWin) {
    const key = headToHeadKey(player, opponent, period);

    if (!headToHead[key]) {
      headToHead[key] = {
        player1UserId: player.userId,
        player1Name: player.name,
        player1Race: player.race,
        player2UserId: opponent.userId,
        player2Name: opponent.name || "",
        player2Race: opponent.race,
        period,
        player1Wins: 0,
        player2Wins: 0,
        totalCount: 0,
      };
    }

    if (isWin) {
      headToHead[key].player1Wins += 1;
    } else {
      headToHead[key].player2Wins += 1;
    }

    headToHead[key].totalCount += 1;
  }

  players.forEach((player) => {
    const recordKey = safeKey(`${player.userId}_${player.race}`);
    const rows = Array.isArray(records[recordKey]) ? records[recordKey] : [];

    rows.forEach((row) => {
      const opponent = findOpponent(row, player);
      if (!opponent || !opponent.userId || !opponent.race) return;

      const date = rowDate(row);
      const isWin = rowIsWin(row, player.userId);

      headPeriods.forEach((period) => {
        if (!periodIncludes(date, period)) return;
        addScore(player, opponent, period, isWin);
      });
    });
  });

  return headToHead;
}

function buildWinRates(players) {
  const winRates = {};

  players.forEach((player) => {
    winRates[safeKey(player.userId)] = {
      userId: player.userId,
      name: player.name,
      race: player.race,
      monthWinRate: player.monthWinRate,
      yearWinRate: player.yearWinRate,
      winRate: player.winRate,
    };
  });

  return winRates;
}

function removeUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(removeUndefined);
  }

  if (value && typeof value === "object") {
    const output = {};

    Object.entries(value).forEach(([key, item]) => {
      if (item === undefined) return;
      output[key] = removeUndefined(item);
    });

    return output;
  }

  return value;
}

function firebaseCredential() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (rawJson) {
    const parsed = JSON.parse(rawJson);

    if (parsed.private_key) {
      parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    }

    return admin.credential.cert(parsed);
  }

  if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    return admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    });
  }

  return admin.credential.applicationDefault();
}

function initFirebase() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: firebaseCredential(),
      databaseURL: FIREBASE_DATABASE_URL,
    });
  }

  return admin.database();
}

async function closeFirebase() {
  await Promise.all(
    admin.apps.map((app) =>
      app.delete().catch((error) => {
        console.warn("[firebase] close failed:", error.message);
      })
    )
  );
}

function isWriteTooBigError(error) {
  const text = `${error && error.code ? error.code : ""} ${
    error && error.message ? error.message : error
  }`;

  return /WRITE_TOO_BIG|write_too_big/i.test(text);
}

function isTransientFirebaseError(error) {
  const text = `${error && error.code ? error.code : ""} ${
    error && error.message ? error.message : error
  }`;

  return /operation was canceled|cancelled|canceled|timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up|network/i.test(
    text
  );
}

async function withRetry(label, worker, maxAttempts = 4) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await worker();
    } catch (error) {
      lastError = error;

      if (isWriteTooBigError(error) || !isTransientFirebaseError(error) || attempt >= maxAttempts) {
        throw error;
      }

      const waitMs = 1000 * attempt;

      console.warn(
        `[firebase] ${label} failed (${error.message}). retry ${attempt}/${
          maxAttempts - 1
        } after ${waitMs}ms`
      );

      await sleep(waitMs);
    }
  }

  throw lastError;
}

async function clearChildrenInChunks(ref, chunkSize, label) {
  let cleared = 0;

  while (true) {
    const snap = await withRetry(`${label} read children for clear`, () =>
      ref.orderByKey().limitToFirst(chunkSize).once("value")
    );

    if (!snap.exists()) {
      break;
    }

    const updates = {};

    snap.forEach((child) => {
      if (child.key != null) {
        updates[child.key] = null;
      }
    });

    const keys = Object.keys(updates);
    if (keys.length === 0) {
      break;
    }

    await withRetry(`${label} clear batch`, () => ref.update(updates));

    cleared += keys.length;
    console.log(`[firebase] ${label} cleared ${cleared}`);
  }
}

async function uploadObjectInChunks(ref, object, chunkSize, label) {
  const entries = Object.entries(object || {});
  const total = entries.length;

  console.log(`[firebase] clear ${label} in child chunks`);
  await clearChildrenInChunks(ref, Math.max(1, chunkSize), label);

  if (total === 0) {
    console.log(`[firebase] ${label} empty`);
    return;
  }

  for (let i = 0; i < total; i += chunkSize) {
    const batch = {};

    entries.slice(i, i + chunkSize).forEach(([key, value]) => {
      batch[key] = value;
    });

    await withRetry(`${label} upload ${i + 1}-${Math.min(i + chunkSize, total)}`, () =>
      ref.update(batch)
    );

    console.log(`[firebase] ${label} uploaded ${Math.min(i + chunkSize, total)}/${total}`);
  }
}

async function uploadArrayRowsInChunks(ref, rows, chunkSize, label) {
  const list = Array.isArray(rows) ? rows : [];

  console.log(`[firebase] clear ${label} rows`);
  await clearChildrenInChunks(ref, Math.max(1, chunkSize), label);

  if (list.length === 0) {
    console.log(`[firebase] ${label} empty`);
    return;
  }

  for (let i = 0; i < list.length; i += chunkSize) {
    const batch = {};

    list.slice(i, i + chunkSize).forEach((row, offset) => {
      batch[String(i + offset)] = row;
    });

    await withRetry(`${label} rows upload ${i + 1}-${Math.min(i + chunkSize, list.length)}`, () =>
      ref.update(batch)
    );

    console.log(`[firebase] ${label} rows uploaded ${Math.min(i + chunkSize, list.length)}/${list.length}`);
  }
}

async function uploadPlayerRecordsSmart(ref, key, rows, rowChunkSize, label) {
  const list = Array.isArray(rows) ? rows : [];
  const playerRef = ref.child(key);

  try {
    await withRetry(`${label}/${key} set`, () => playerRef.set(list));
    console.log(`[firebase] ${label}/${key} set uploaded ${list.length}`);
    return;
  } catch (error) {
    if (!isWriteTooBigError(error)) {
      throw error;
    }

    console.warn(`[firebase] ${label}/${key} set too big. fallback to row chunks: ${error.message}`);
  }

  await uploadArrayRowsInChunks(playerRef, list, rowChunkSize, `${label}/${key}`);
}

async function uploadRecordsInChunks(ref, records, rowChunkSize, label) {
  const entries = Object.entries(records || {});
  const total = entries.length;

  if (total === 0) {
    console.log(`[firebase] ${label} empty`);
    return;
  }

  for (let i = 0; i < total; i += 1) {
    const [key, rows] = entries[i];

    await uploadPlayerRecordsSmart(ref, key, rows, rowChunkSize, label);

    console.log(`[firebase] ${label} players uploaded ${i + 1}/${total}`);
  }
}

async function readExistingLiveState(rootRef) {
  console.log("[firebase] read existing liveStatus");

  const snap = await withRetry("liveStatus read", () =>
    rootRef.child("liveStatus").once("value")
  );

  const liveStatus = snap.val() || {};

  const liveCount = Object.values(liveStatus).filter(
    (item) => item && item.live === true
  ).length;

  return {
    liveStatus,
    liveCount,
  };
}

function applyExistingLiveToPlayers(players, liveStatus) {
  return (players || []).map((player) => {
    const liveInfo = liveStatus[safeKey(player.userId)] || null;
    const isLive = Boolean(liveInfo && liveInfo.live);

    return {
      ...player,
      live: isLive,
      broad: isLive
        ? {
            broadNo: liveInfo.broadNo || "",
            title: liveInfo.title || "",
            startAt: liveInfo.startAt || "",
            categoryTags: liveInfo.categoryTags || [],
            totalViewCount: liveInfo.totalViewCount || 0,
            thumbnail: liveInfo.thumbnail || "",
            profileImg: liveInfo.profileImg || "",
          }
        : null,
      broadcastUrl: isLive ? liveInfo.broadcastUrl || "" : "",
    };
  });
}

async function uploadToFirebase(payload) {
  const db = initFirebase();
  const cleanPayload = removeUndefined(payload);
  const rootRef = db.ref(FIREBASE_ROOT);

  const { liveStatus: existingLiveStatus, liveCount: existingLiveCount } =
    await readExistingLiveState(rootRef);

  const playersWithPreservedLive = applyExistingLiveToPlayers(
    cleanPayload.players || [],
    existingLiveStatus
  );

  const metaWithPreservedLive = {
    ...(cleanPayload.meta || {}),
    liveCount: existingLiveCount,
    liveSource: "preserved-from-soop-sync",
  };

  console.log("[firebase] upload meta");
  await rootRef.child("meta").set(metaWithPreservedLive);

  console.log("[firebase] upload players");
  await rootRef.child("players").set(playersWithPreservedLive);

  console.log("[firebase] upload winRates");
  await rootRef.child("winRates").set(cleanPayload.winRates || {});

  console.log("[firebase] upload records in row chunks");
  await uploadRecordsInChunks(rootRef.child("records"), cleanPayload.records || {}, 100, "records");

  console.log("[firebase] upload headToHead in chunks");
  await uploadObjectInChunks(rootRef.child("headToHead"), cleanPayload.headToHead || {}, 100, "headToHead");

  console.log("[firebase] upload public meta");
  await db.ref("starcraftTier/meta").set({
    lastSyncedAt: metaWithPreservedLive.syncedAt,
    currentRoot: FIREBASE_ROOT,
    playerCount: metaWithPreservedLive.playerCount,
    liveCount: existingLiveCount,
    recordPlayerCount: metaWithPreservedLive.recordPlayerCount,
    recordRowCount: metaWithPreservedLive.recordRowCount,
    recordFailCount: metaWithPreservedLive.recordFailCount,
    headToHeadCount: metaWithPreservedLive.headToHeadCount,
    sourceLastUpdatedAt: metaWithPreservedLive.sourceLastUpdatedAt,
  });

  console.log("[firebase] upload complete");

  return metaWithPreservedLive;
}

async function main() {
  await Promise.all(
    [dataDir, recordDir, assetDir, profileDir, academyDir].map((dir) =>
      fs.mkdir(dir, { recursive: true })
    )
  );

  console.log("[config]", {
    FIREBASE_ROOT,
    FETCH_TIMEOUT_MS,
    RECORD_CONCURRENCY,
    RECORD_MAX_PAGES,
    CACHE_LOCAL_JSON,
    CACHE_LOCAL_ASSETS,
  });

  console.log("[1/6] CNINE 기본 데이터 수집 시작");

  const [playersResult, academiesResult, academyPlayersResult, winRatesResult, lastUpdated] =
    await Promise.all([
      getJson(
        "https://www.cnine.kr/api/v2/p/starcraft/soop/player?page=1&size=1000&orderBy=sortOrder&order=asc&enabled=true"
      ),
      getJson(
        "https://www.cnine.kr/api/v2/p/starcraft/soop/academy?page=1&size=1000&orderBy=sortOrder&order=asc&visible=true"
      ),
      getJson(
        "https://www.cnine.kr/api/v2/p/starcraft/soop/academy/player?page=1&size=1000&orderBy=sortOrder&order=asc"
      ),
      getJson(
        "https://www.cnine.kr/api/v2/p/starcraft/soop/player/win-rate?page=1&size=1000&orderBy=id&order=desc"
      ),
      getJson("https://www.cnine.kr/api/v2/p/starcraft/eloboard/last-updated-at").catch(() => ({
        lastUpdatedAt: null,
      })),
    ]);

  const academyList = playersResult && academiesResult ? academiesResult.data || [] : [];
  const playerList = playersResult.data || [];
  const academyPlayerList = academyPlayersResult.data || [];
  const winRateList = winRatesResult.data || [];

  const academies = new Map(academyList.map((item) => [item.id, item]));

  const academyByPlayer = new Map();

  academyPlayerList.forEach((relation) => {
    if (!academyByPlayer.has(relation.playerId)) {
      academyByPlayer.set(relation.playerId, relation);
    }
  });

  const winRateById = new Map(winRateList.map((item) => [item.id, item]));

  console.log("[2/6] 선택적 이미지 캐시 처리");

  const academyLocal = new Map();

  if (CACHE_LOCAL_ASSETS) {
    await download("https://www.cnine.kr/img/logo/logo-dark.png?v=1", path.join(assetDir, "logo-dark.png")).catch(
      () => false
    );

    await mapLimit(academyList, 8, async (academy) => {
      const url = normalizeUrl(academy.logoImageUrl);
      if (!url) return;

      const target = path.join(academyDir, `${academy.id}.jpg`);
      const ok = await download(url, target).catch(() => false);

      if (ok) {
        academyLocal.set(academy.id, localPath(path.join("assets", "academy", `${academy.id}.jpg`)));
      }
    });

    let imageOk = 0;

    await mapLimit(playerList, 12, async (player) => {
      const target = path.join(profileDir, `${player.userId}.jpg`);
      const ok = await download(player.profileImageUrl, target).catch(() => false);
      if (ok) imageOk += 1;
    });

    console.log(`profile image cached: ${imageOk}/${playerList.length}`);
  }

  console.log("[3/6] SOOP 방송국 상태 확인 시작");

  const stationChecks = await mapLimit(playerList, 12, async (player) => {
    const station = `https://www.sooplive.com/station/${player.userId}`;

    const result = await getText(station).catch((error) => ({
      status: 0,
      error: error.message,
    }));

    return {
      userId: player.userId,
      status: result.status,
    };
  });

  const stationStatus = new Map(stationChecks.map((item) => [item.userId, item.status]));

  const players = playerList
    .map((player) => {
      const academyRelation = academyByPlayer.get(player.id);
      const academy = academyRelation ? academies.get(academyRelation.academyId) : null;
      const rate = winRateById.get(player.id);

      const localProfileImage = localPath(path.join("assets", "profile", `${player.userId}.jpg`));

      return {
        id: player.id,
        userId: player.userId,
        name: player.name,
        description: player.description || "",
        race: player.race,
        tierCode: player.tier,
        tier: tierName[player.tier] || `${player.tier}티어`,
        tierId: `tier-${player.tier}`,
        sortOrder: player.sortOrder,

        eloboardKey: player.eloboardKey || "",
        elo: eloboardUrl(player.eloboardKey, player.race),

        image: CACHE_LOCAL_ASSETS ? localProfileImage : normalizeUrl(player.profileImageUrl),
        sourceImage: normalizeUrl(player.profileImageUrl),

        station: `https://www.sooplive.com/station/${player.userId}`,
        stationStatus: stationStatus.get(player.userId) || 0,

        academy: academy
          ? {
              id: academy.id,
              name: academy.name,
              image: academyLocal.get(academy.id) || normalizeUrl(academy.logoImageUrl),
              sourceImage: normalizeUrl(academy.logoImageUrl),
              position: academyRelation.position || "",
            }
          : null,

        monthWinRate: rate && rate.monthWinRate != null ? Number(rate.monthWinRate) : null,
        yearWinRate: rate && rate.yearWinRate != null ? Number(rate.yearWinRate) : null,
        winRate: rate && rate.monthWinRate != null ? `${Number(rate.monthWinRate).toFixed(0)}%` : "",

        live: false,
        broad: null,
        broadcastUrl: "",
      };
    })
    .sort((a, b) => {
      const aTierIndex = tierOrder.indexOf(a.tierCode);
      const bTierIndex = tierOrder.indexOf(b.tierCode);

      const tierDiff =
        (aTierIndex === -1 ? 999 : aTierIndex) -
        (bTierIndex === -1 ? 999 : bTierIndex);

      if (tierDiff !== 0) return tierDiff;

      return Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
    });

  console.log(`[4/6] ELO 전적 수집 시작: ${players.length}명`);

  const records = {};
  let recordPlayerCount = 0;
  let recordRowCount = 0;
  let recordFailCount = 0;

  await mapLimit(players, RECORD_CONCURRENCY, async (player, index) => {
    const key = safeKey(`${player.userId}_${player.race}`);

    const rows = await fetchRecords(player).catch((error) => {
      recordFailCount += 1;
      console.warn(`[records fail] ${player.name}(${player.userId}/${player.race}): ${error.message}`);
      return [];
    });

    records[key] = rows;

    if (rows.length > 0) {
      recordPlayerCount += 1;
      recordRowCount += rows.length;
    }

    if (CACHE_LOCAL_JSON) {
      await fs.writeFile(path.join(recordDir, `${key}.json`), JSON.stringify(rows));
    }

    if ((index + 1) % 25 === 0 || index + 1 === players.length) {
      console.log(`records ${index + 1}/${players.length}`);
    }
  });

  console.log("[5/6] Firebase 업로드 데이터 구성");

  const winRates = buildWinRates(players);
  const headToHead = buildHeadToHead(players, records);

  const nowIso = new Date().toISOString();

  const meta = {
    collectedAt: nowIso,
    syncedAt: nowIso,
    updatedAt: nowIso,
    sourceLastUpdatedAt: lastUpdated.lastUpdatedAt || null,
    eloboardUpdatedAt: lastUpdated.lastUpdatedAt || null,
    playerCount: players.length,
    liveCount: 0,
    stationVisitedCount: stationChecks.filter((item) => item.status >= 200 && item.status < 400).length,
    recordPlayerCount,
    recordRowCount,
    recordFailCount,
    headToHeadCount: Object.keys(headToHead).length,
    fetchTimeoutMs: FETCH_TIMEOUT_MS,
    recordConcurrency: RECORD_CONCURRENCY,
    recordMaxPages: RECORD_MAX_PAGES,
    source: "cnine.kr",
    liveSource: "preserved-from-soop-sync",
  };

  const payload = {
    meta,
    players,
    records,
    winRates,
    headToHead,
  };

  if (CACHE_LOCAL_JSON) {
    await fs.writeFile(path.join(dataDir, "players.json"), JSON.stringify({ meta, players }, null, 2));
    await fs.writeFile(path.join(dataDir, "records.json"), JSON.stringify(records));
    await fs.writeFile(path.join(dataDir, "headToHead.json"), JSON.stringify(headToHead));
    await fs.writeFile(path.join(dataDir, "meta.json"), JSON.stringify(meta, null, 2));
  }

  console.log(`[6/6] Firebase 업로드 시작: ${FIREBASE_ROOT}`);

  const uploadedMeta = await uploadToFirebase(payload);

  console.log(
    JSON.stringify(
      {
        ok: true,
        firebaseRoot: FIREBASE_ROOT,
        meta: uploadedMeta,
      },
      null,
      2
    )
  );
}

main()
  .then(async () => {
    await Promise.race([closeFirebase(), sleep(3000)]);
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await Promise.race([closeFirebase(), sleep(3000)]);
    process.exit(1);
  });
