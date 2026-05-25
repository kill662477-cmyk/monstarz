const fs = require("fs/promises");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "data");
const recordDir = path.join(dataDir, "records");
const assetDir = path.join(root, "assets");
const profileDir = path.join(assetDir, "profile");
const academyDir = path.join(assetDir, "academy");

const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 15000);
const RECORD_CONCURRENCY = Number(process.env.RECORD_CONCURRENCY || 3);
const RECORD_MAX_PAGES = Number(process.env.RECORD_MAX_PAGES || 30);

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

function normalizeUrl(url) {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

function eloboardUrl(key, race) {
  if (!key) return "";

  const matched = key
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

async function ensureDir(dir) {
  try {
    const stat = await fs.stat(dir);

    if (!stat.isDirectory()) {
      await fs.rm(dir, { force: true });
      await fs.mkdir(dir, { recursive: true });
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await fs.mkdir(dir, { recursive: true });
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Timeout ${timeoutMs}ms ${url}`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url) {
  const response = await fetchWithTimeout(url, {
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
  const response = await fetchWithTimeout(url, {
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

  const response = await fetchWithTimeout(fullUrl, {
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
      const index = next;
      next += 1;
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

    const result = await getJson(
      `https://www.cnine.kr/api/v2/p/starcraft/eloboard?${params}`
    );

    const pageRows = Array.isArray(result.data) ? result.data : [];

    if (pageRows.length === 0) break;

    rows.push(...pageRows);
    total = Number(result.total || rows.length);

    if (rows.length >= total) break;

    page += 1;
  }

  if (page > RECORD_MAX_PAGES) {
    console.warn(
      `[records] max page reached: ${player.name || player.userId} ${player.race}, rows=${rows.length}`
    );
  }

  return rows;
}

function safeTierIndex(tierCode) {
  const index = tierOrder.indexOf(tierCode);
  return index >= 0 ? index : tierOrder.length;
}

async function main() {
  await Promise.all([
    dataDir,
    recordDir,
    assetDir,
    profileDir,
    academyDir,
  ].map(ensureDir));

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
      () => ({ lastUpdatedAt: null })
    ),
  ]);

  const playerRows = Array.isArray(playersResult.data) ? playersResult.data : [];
  const academyRows = Array.isArray(academiesResult.data)
    ? academiesResult.data
    : [];
  const academyPlayerRows = Array.isArray(academyPlayersResult.data)
    ? academyPlayersResult.data
    : [];
  const winRateRows = Array.isArray(winRatesResult.data)
    ? winRatesResult.data
    : [];
  const broadRows = Array.isArray(broadResult) ? broadResult : [];

  const academies = new Map(academyRows.map((item) => [item.id, item]));

  const academyByPlayer = new Map();
  academyPlayerRows.forEach((relation) => {
    if (!academyByPlayer.has(relation.playerId)) {
      academyByPlayer.set(relation.playerId, relation);
    }
  });

  const winRateById = new Map(winRateRows.map((item) => [item.id, item]));
  const broadByUserId = new Map(broadRows.map((item) => [item.userId, item]));

  await download(
    "https://www.cnine.kr/img/logo/logo-dark.png?v=1",
    path.join(assetDir, "logo-dark.png")
  ).catch((error) => {
    console.warn(`[logo] skipped: ${error.message}`);
    return false;
  });

  const academyLocal = new Map();

  await mapLimit(academyRows, 5, async (academy) => {
    const url = normalizeUrl(academy.logoImageUrl);
    if (!url) return;

    const target = path.join(academyDir, `${academy.id}.jpg`);
    const ok = await download(url, target).catch((error) => {
      console.warn(`[academy image] skipped ${academy.id}: ${error.message}`);
      return false;
    });

    if (ok) {
      academyLocal.set(academy.id, `assets/academy/${academy.id}.jpg`);
    }
  });

  const stationChecks = await mapLimit(playerRows, 6, async (player) => {
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

  const stationStatus = new Map(
    stationChecks.map((item) => [item.userId, item.status])
  );

  let imageOk = 0;

  await mapLimit(playerRows, 6, async (player) => {
    const target = path.join(profileDir, `${player.userId}.jpg`);

    const ok = await download(player.profileImageUrl, target).catch((error) => {
      console.warn(`[profile image] skipped ${player.userId}: ${error.message}`);
      return false;
    });

    if (ok) imageOk += 1;
  });

  const players = playerRows
    .map((player) => {
      const academyRelation = academyByPlayer.get(player.id);
      const academy = academyRelation
        ? academies.get(academyRelation.academyId)
        : null;
      const rate = winRateById.get(player.id);
      const broad = broadByUserId.get(player.userId) || null;

      return {
        id: player.id,
        userId: player.userId,
        name: player.name,
        description: player.description || "",
        race: player.race,
        tierCode: player.tier,
        tierId: `tier-${player.tier}`,
        tier: tierName[player.tier] || `${player.tier}티어`,
        sortOrder: Number(player.sortOrder || 0),
        eloboardKey: player.eloboardKey || "",
        elo: eloboardUrl(player.eloboardKey, player.race),
        image: `assets/profile/${player.userId}.jpg`,
        sourceImage: normalizeUrl(player.profileImageUrl),
        station: `https://www.sooplive.com/station/${player.userId}`,
        stationStatus: stationStatus.get(player.userId) || 0,
        academy: academy
          ? {
              id: academy.id,
              name: academy.name,
              image:
                academyLocal.get(academy.id) || normalizeUrl(academy.logoImageUrl),
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
      const tierDiff = safeTierIndex(a.tierCode) - safeTierIndex(b.tierCode);
      if (tierDiff !== 0) return tierDiff;
      return a.sortOrder - b.sortOrder;
    });

  let recordPlayerCount = 0;
  let recordDoneCount = 0;
  const recordErrors = [];

  await mapLimit(players, RECORD_CONCURRENCY, async (player) => {
    let rows = [];

    try {
      rows = await fetchRecords(player);
    } catch (error) {
      recordErrors.push({
        userId: player.userId,
        name: player.name,
        race: player.race,
        error: error.message,
      });

      console.warn(
        `[records] skipped ${player.name || player.userId} ${player.race}: ${error.message}`
      );
    }

    if (rows.length > 0) {
      recordPlayerCount += 1;
    }

    await fs.writeFile(
      path.join(recordDir, `${player.userId}_${player.race}.json`),
      JSON.stringify(rows, null, 2)
    );

    recordDoneCount += 1;

    if (recordDoneCount % 25 === 0 || recordDoneCount === players.length) {
      console.log(`records ${recordDoneCount}/${players.length}`);
    }
  });

  const meta = {
    collectedAt: new Date().toISOString(),
    sourceLastUpdatedAt: lastUpdated.lastUpdatedAt || null,
    playerCount: players.length,
    stationVisitedCount: stationChecks.filter(
      (item) => item.status >= 200 && item.status < 400
    ).length,
    imageCachedCount: imageOk,
    recordPlayerCount,
    recordErrorCount: recordErrors.length,
    recordErrors,
  };

  await fs.writeFile(
    path.join(dataDir, "players.json"),
    JSON.stringify({ meta, players }, null, 2)
  );

  await fs.writeFile(
    path.join(dataDir, "meta.json"),
    JSON.stringify(meta, null, 2)
  );

  const indexPath = path.join(root, "tierboard_calm_tab.html");
  let html = await fs.readFile(indexPath, "utf8");

  const tierDataPattern = new RegExp(
    '<script id="tier-data" type="application/json">[\\s\\S]*?</script>'
  );

  if (!tierDataPattern.test(html)) {
    throw new Error(
      'tierboard_calm_tab.html 안에서 <script id="tier-data" type="application/json">...</script>를 찾지 못했습니다.'
    );
  }

  html = html.replace(
    tierDataPattern,
    `<script id="tier-data" type="application/json">${JSON.stringify(players)}</script>`
  );

  html = html
    .split("https://www.cnine.kr/img/logo/logo-dark.png?v=1")
    .join("assets/logo-dark.png");

  await fs.writeFile(indexPath, html);

  console.log(JSON.stringify(meta, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
