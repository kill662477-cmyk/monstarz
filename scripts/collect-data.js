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
  return String(value || "").replace(/[.#$/[\]]/g, "_");
}

function localPath(file) {
  return file.split(path.sep).join("/");
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

async function getJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "application/json,text/plain,*/*",
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${url}`);
  }

  return response.json();
}

async function getText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
    },
  });

  return {
    status: response.status,
    text: await response.text(),
  };
}

async function download(url, target) {
  const fullUrl = normalizeUrl(url);
  if (!fullUrl) return false;

  const response = await fetch(fullUrl, {
    headers: {
      "user-agent": "Mozilla/5.0",
    },
  });

  if (!response.ok) return false;

  await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
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

  do {
    const params = new URLSearchParams({
      soopUserId: player.userId,
      race: player.race,
      page: String(page),
      size: "1000",
      orderBy: "id",
      order: "desc",
    });

    const result = await getJson(
      `https://www.cnine.kr/api/v2/p/starcraft/eloboard?${params}`
    );

    rows.push(...(result.data || []));
    total = result.total || rows.length;
    page += 1;
  } while (rows.length < total);

  return rows;
}

function rowDate(row) {
  return String(
    row.date ||
      row.standardDate ||
      row.playedAt ||
      row.createdAt ||
      row.updatedAt ||
      ""
  ).slice(0, 10);
}

function rowWinnerId(row) {
  return String(
    row.winnerSoopUserId ||
      row.winnerUserId ||
      row.winnerId ||
      row.winner ||
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

function rowOpponentName(row, userId) {
  const winnerId = rowWinnerId(row);
  const isWin = winnerId && winnerId === String(userId);

  return isWin
    ? row.losePlayer ||
        row.loserPlayer ||
        row.loseName ||
        row.loserName ||
        row.opponentName ||
        ""
    : row.winnerPlayer || row.winnerName || row.opponentName || "";
}

function rowOpponentRace(row, userId) {
  const winnerId = rowWinnerId(row);
  const isWin = winnerId && winnerId === String(userId);

  return isWin
    ? row.loseRace || row.loserRace || row.opponentRace || ""
    : row.winnerRace || row.opponentRace || "";
}

function rowOpponentId(row, userId) {
  const winnerId = rowWinnerId(row);
  const loserId = rowLoserId(row);

  if (winnerId && winnerId === String(userId)) return loserId;
  if (loserId && loserId === String(userId)) return winnerId;

  return "";
}

function rowIsWin(row, userId) {
  const winnerId = rowWinnerId(row);

  if (winnerId) {
    return winnerId === String(userId);
  }

  const result = String(row.result || row.win || "").toLowerCase();
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

function buildLiveStatus(players) {
  const liveStatus = {};
  const checkedAt = new Date().toISOString();

  players.forEach((player) => {
    liveStatus[safeKey(player.userId)] = player.live
      ? {
          live: true,
          status: "live",
          userId: player.userId,
          name: player.name,
          race: player.race,
          broadNo: player.broad ? player.broad.broadNo : "",
          title: player.broad ? player.broad.title : "",
          startAt: player.broad ? player.broad.startAt : "",
          categoryTags: player.broad ? player.broad.categoryTags || [] : [],
          totalViewCount: player.broad ? player.broad.totalViewCount || 0 : 0,
          broadcastUrl: player.broadcastUrl || "",
          checkedAt,
        }
      : {
          live: false,
          status: "offline",
          userId: player.userId,
          name: player.name,
          race: player.race,
          broadNo: "",
          title: "",
          startAt: "",
          categoryTags: [],
          totalViewCount: 0,
          broadcastUrl: "",
          checkedAt,
        };
  });

  return liveStatus;
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

async function uploadToFirebase(payload) {
  const db = initFirebase();
  const cleanPayload = removeUndefined(payload);

  await db.ref(FIREBASE_ROOT).set(cleanPayload);

  await db.ref("starcraftTier/meta").set({
    lastSyncedAt: cleanPayload.meta.syncedAt,
    currentRoot: FIREBASE_ROOT,
    playerCount: cleanPayload.meta.playerCount,
    liveCount: cleanPayload.meta.liveCount,
    recordPlayerCount: cleanPayload.meta.recordPlayerCount,
    recordRowCount: cleanPayload.meta.recordRowCount,
    headToHeadCount: cleanPayload.meta.headToHeadCount,
    sourceLastUpdatedAt: cleanPayload.meta.sourceLastUpdatedAt,
  });
}

async function main() {
  await Promise.all([
    dataDir,
    recordDir,
    assetDir,
    profileDir,
    academyDir,
  ].map((dir) => fs.mkdir(dir, { recursive: true })));

  console.log("[1/6] CNINE 기본 데이터 수집 시작");

  const [
    playersResult,
    academiesResult,
    academyPlayersResult,
    winRatesResult,
    broadResult,
    lastUpdated,
  ] = await Promise.all([
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
    getJson("https://www.cnine.kr/api/v2/p/starcraft/soop/player/broad?"),
    getJson("https://www.cnine.kr/api/v2/p/starcraft/eloboard/last-updated-at").catch(
      () => ({
        lastUpdatedAt: null,
      })
    ),
  ]);

  const academyList = academiesResult.data || [];
  const playerList = playersResult.data || [];
  const academyPlayerList = academyPlayersResult.data || [];
  const winRateList = winRatesResult.data || [];
  const broadList = broadResult || [];

  const academies = new Map(academyList.map((item) => [item.id, item]));

  const academyByPlayer = new Map();
  academyPlayerList.forEach((relation) => {
    if (!academyByPlayer.has(relation.playerId)) {
      academyByPlayer.set(relation.playerId, relation);
    }
  });

  const winRateById = new Map(winRateList.map((item) => [item.id, item]));
  const broadByUserId = new Map(broadList.map((item) => [item.userId, item]));

  console.log("[2/6] 선택적 이미지 캐시 처리");

  const academyLocal = new Map();

  if (CACHE_LOCAL_ASSETS) {
    await download(
      "https://www.cnine.kr/img/logo/logo-dark.png?v=1",
      path.join(assetDir, "logo-dark.png")
    ).catch(() => false);

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
      const broad = broadByUserId.get(player.userId) || null;

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

        monthWinRate:
          rate && rate.monthWinRate != null ? Number(rate.monthWinRate) : null,
        yearWinRate:
          rate && rate.yearWinRate != null ? Number(rate.yearWinRate) : null,
        winRate:
          rate && rate.monthWinRate != null
            ? `${Number(rate.monthWinRate).toFixed(0)}%`
            : "",

        live: Boolean(broad),

        broad: broad
          ? {
              broadNo: broad.broadNo,
              title: broad.broadTitle,
              startAt: broad.broadStartAt,
              categoryTags: broad.categoryTags || [],
              totalViewCount: broad.totalViewCount || 0,
            }
          : null,

        broadcastUrl: broad
          ? `https://play.sooplive.com/${player.userId}/${broad.broadNo}`
          : "",
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

  await mapLimit(players, 6, async (player, index) => {
    const key = safeKey(`${player.userId}_${player.race}`);

    const rows = await fetchRecords(player).catch((error) => {
      console.warn(
        `[records fail] ${player.name}(${player.userId}/${player.race}): ${error.message}`
      );
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

  const liveStatus = buildLiveStatus(players);
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
    liveCount: players.filter((player) => player.live).length,
    stationVisitedCount: stationChecks.filter(
      (item) => item.status >= 200 && item.status < 400
    ).length,
    recordPlayerCount,
    recordRowCount,
    headToHeadCount: Object.keys(headToHead).length,
    source: "cnine.kr",
  };

  const payload = {
    meta,
    players,
    records,
    liveStatus,
    winRates,
    headToHead,
  };

  if (CACHE_LOCAL_JSON) {
    await fs.writeFile(
      path.join(dataDir, "players.json"),
      JSON.stringify({ meta, players }, null, 2)
    );
    await fs.writeFile(path.join(dataDir, "records.json"), JSON.stringify(records));
    await fs.writeFile(
      path.join(dataDir, "liveStatus.json"),
      JSON.stringify(liveStatus, null, 2)
    );
    await fs.writeFile(path.join(dataDir, "headToHead.json"), JSON.stringify(headToHead));
    await fs.writeFile(path.join(dataDir, "meta.json"), JSON.stringify(meta, null, 2));
  }

  console.log(`[6/6] Firebase 업로드 시작: ${FIREBASE_ROOT}`);

  await uploadToFirebase(payload);

  console.log(
    JSON.stringify(
      {
        ok: true,
        firebaseRoot: FIREBASE_ROOT,
        meta,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
