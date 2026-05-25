const fs = require("fs/promises");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "data");
const recordDir = path.join(dataDir, "records");
const assetDir = path.join(root, "assets");
const profileDir = path.join(assetDir, "profile");
const academyDir = path.join(assetDir, "academy");

const tierName = {
  G: "갓티어",
  K: "킹티어",
  J: "잭티어",
  O: "조커티어",
  S: "스페이드티어",
  B: "베이비티어",
  N: "티어없음",
};

const tierOrder = ["G", "K", "J", "O", "S", "0", "1", "2", "3", "4", "5", "6", "7", "8", "B", "N"];

function normalizeUrl(url) {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

function localPath(file) {
  return file.split(path.sep).join("/");
}

function eloboardUrl(key, race) {
  if (!key) return "";
  const matched = key.split(",").find((item) => item.split("_")[2] === race);
  if (!matched) return "";
  const [type, id] = matched.split("_");
  if (type === "W") return `https://eloboard.com/women/bbs/board.php?bo_table=bj_list&wr_id=${id}`;
  if (type === "M") return `https://eloboard.com/women/bbs/board.php?bo_table=bj_m_list&wr_id=${id}`;
  if (type === "P") return `https://eloboard.com/men/bbs/board.php?bo_table=bj_list&wr_id=${id}`;
  return "";
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0", accept: "application/json,text/plain,*/*" },
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function getText(url) {
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  return { status: response.status, text: await response.text() };
}

async function download(url, target) {
  const fullUrl = normalizeUrl(url);
  if (!fullUrl) return false;
  const response = await fetch(fullUrl, { headers: { "user-agent": "Mozilla/5.0" } });
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
    const result = await getJson(`https://www.cnine.kr/api/v2/p/starcraft/eloboard?${params}`);
    rows.push(...(result.data || []));
    total = result.total || rows.length;
    page += 1;
  } while (rows.length < total);
  return rows;
}

async function main() {
  await Promise.all([dataDir, recordDir, assetDir, profileDir, academyDir].map((dir) => fs.mkdir(dir, { recursive: true })));

  const [playersResult, academiesResult, academyPlayersResult, winRatesResult, broadResult, lastUpdated] = await Promise.all([
    getJson("https://www.cnine.kr/api/v2/p/starcraft/soop/player?page=1&size=1000&orderBy=sortOrder&order=asc&enabled=true"),
    getJson("https://www.cnine.kr/api/v2/p/starcraft/soop/academy?page=1&size=1000&orderBy=sortOrder&order=asc&visible=true"),
    getJson("https://www.cnine.kr/api/v2/p/starcraft/soop/academy/player?page=1&size=1000&orderBy=sortOrder&order=asc"),
    getJson("https://www.cnine.kr/api/v2/p/starcraft/soop/player/win-rate?page=1&size=1000&orderBy=id&order=desc"),
    getJson("https://www.cnine.kr/api/v2/p/starcraft/soop/player/broad?"),
    getJson("https://www.cnine.kr/api/v2/p/starcraft/eloboard/last-updated-at").catch(() => ({ lastUpdatedAt: null })),
  ]);

  const academies = new Map(academiesResult.data.map((item) => [item.id, item]));
  const academyByPlayer = new Map();
  academyPlayersResult.data.forEach((relation) => {
    if (!academyByPlayer.has(relation.playerId)) academyByPlayer.set(relation.playerId, relation);
  });
  const winRateById = new Map(winRatesResult.data.map((item) => [item.id, item]));
  const broadByUserId = new Map(broadResult.map((item) => [item.userId, item]));

  await download("https://www.cnine.kr/img/logo/logo-dark.png?v=1", path.join(assetDir, "logo-dark.png")).catch(() => false);

  const academyLocal = new Map();
  await mapLimit(academiesResult.data, 8, async (academy) => {
    const url = normalizeUrl(academy.logoImageUrl);
    if (!url) return;
    const target = path.join(academyDir, `${academy.id}.jpg`);
    const ok = await download(url, target).catch(() => false);
    if (ok) academyLocal.set(academy.id, `assets/academy/${academy.id}.jpg`);
  });

  const stationChecks = await mapLimit(playersResult.data, 12, async (player) => {
    const station = `https://www.sooplive.com/station/${player.userId}`;
    const result = await getText(station).catch((error) => ({ status: 0, error: error.message }));
    return { userId: player.userId, status: result.status };
  });
  const stationStatus = new Map(stationChecks.map((item) => [item.userId, item.status]));

  let imageOk = 0;
  await mapLimit(playersResult.data, 12, async (player) => {
    const target = path.join(profileDir, `${player.userId}.jpg`);
    const ok = await download(player.profileImageUrl, target).catch(() => false);
    if (ok) imageOk += 1;
  });

  const players = playersResult.data
    .map((player) => {
      const academyRelation = academyByPlayer.get(player.id);
      const academy = academyRelation ? academies.get(academyRelation.academyId) : null;
      const rate = winRateById.get(player.id);
      const broad = broadByUserId.get(player.userId) || null;
      return {
        id: player.id,
        userId: player.userId,
        name: player.name,
        description: player.description || "",
        race: player.race,
        tierCode: player.tier,
        tier: tierName[player.tier] || `${player.tier}티어`,
        sortOrder: player.sortOrder,
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
              image: academyLocal.get(academy.id) || normalizeUrl(academy.logoImageUrl),
              position: academyRelation.position || "",
            }
          : null,
        monthWinRate: rate && rate.monthWinRate != null ? Number(rate.monthWinRate) : null,
        yearWinRate: rate && rate.yearWinRate != null ? Number(rate.yearWinRate) : null,
        winRate: rate && rate.monthWinRate != null ? `${Number(rate.monthWinRate).toFixed(0)}%` : "",
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
        broadcastUrl: broad ? `https://play.sooplive.com/${player.userId}/${broad.broadNo}` : "",
      };
    })
    .sort((a, b) => {
      const tierDiff = tierOrder.indexOf(a.tierCode) - tierOrder.indexOf(b.tierCode);
      if (tierDiff !== 0) return tierDiff;
      return a.sortOrder - b.sortOrder;
    });

  let recordPlayerCount = 0;
  await mapLimit(players, 6, async (player, index) => {
    const rows = await fetchRecords(player).catch(() => []);
    if (rows.length > 0) recordPlayerCount += 1;
    await fs.writeFile(path.join(recordDir, `${player.userId}_${player.race}.json`), JSON.stringify(rows));
    if ((index + 1) % 25 === 0) console.log(`records ${index + 1}/${players.length}`);
  });

  const meta = {
    collectedAt: new Date().toISOString(),
    sourceLastUpdatedAt: lastUpdated.lastUpdatedAt || null,
    playerCount: players.length,
    stationVisitedCount: stationChecks.filter((item) => item.status >= 200 && item.status < 400).length,
    imageCachedCount: imageOk,
    recordPlayerCount,
  };

  await fs.writeFile(path.join(dataDir, "players.json"), JSON.stringify({ meta, players }, null, 2));
  await fs.writeFile(path.join(dataDir, "meta.json"), JSON.stringify(meta, null, 2));

  const indexPath = path.join(root, "tierboard_calm_tab.html");
  let html = await fs.readFile(indexPath, "utf8");
  html = html.replace(/<script id="tier-data" type="application\\/json">[\\s\\S]*?<\\/script>/, `<script id="tier-data" type="application/json">${JSON.stringify(players)}</script>`);
  html = html.replace(/https:\\/\\/www\\.cnine\\.kr\\/img\\/logo\\/logo-dark\\.png\\?v=1/g, "assets/logo-dark.png");
  await fs.writeFile(indexPath, html);

  console.log(JSON.stringify(meta, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
