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

const MANUAL_PLAYERS_PATH = process.env.MANUAL_PLAYERS_PATH
  ? path.resolve(process.env.MANUAL_PLAYERS_PATH)
  : path.join(dataDir, "manual", "players.json");

const FETCH_TIMEOUT_MS = Math.max(3000, Number(process.env.FETCH_TIMEOUT_MS || 15000));
const RECORD_CONCURRENCY = Math.max(1, Number(process.env.RECORD_CONCURRENCY || 3));
const RECORD_MAX_PAGES = Math.max(1, Number(process.env.RECORD_MAX_PAGES || 30));
const ELOBOARD_MAX_ROWS_PER_PLAYER = Math.max(1, Number(process.env.ELOBOARD_MAX_ROWS_PER_PLAYER || 5000));
const INACTIVE_RECORD_MONTHS = Math.max(1, Number(process.env.INACTIVE_RECORD_MONTHS || 4));
const HIDE_INACTIVE_PLAYERS = process.env.HIDE_INACTIVE_PLAYERS !== "false";

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

function eloboardRecordUrl(player) {
  return normalizeUrl(player.elo || eloboardUrl(player.eloboardKey, player.race));
}

function normalizeRace(value) {
  const raw = String(value || "").trim().toUpperCase();

  if (raw === "T" || raw === "TERRAN" || raw === "테란") return "T";
  if (raw === "Z" || raw === "ZERG" || raw === "저그") return "Z";
  if (raw === "P" || raw === "PROTOSS" || raw === "토스" || raw === "프로토스") return "P";

  return raw || "";
}

function normalizeTierCode(value, fallbackTier) {
  const raw = String(value || "").trim();
  const tierText = String(fallbackTier || "").trim();

  if (tierOrder.includes(raw)) return raw;

  const map = {
    갓티어: "G",
    킹티어: "K",
    잭티어: "J",
    조커티어: "O",
    스페이드티어: "S",
    베이비티어: "B",
    티어없음: "N",
    없음: "N",
  };

  if (map[raw]) return map[raw];
  if (map[tierText]) return map[tierText];

  const numberMatch = raw.match(/^([0-8])(?:티어)?$/) || tierText.match(/^([0-8])(?:티어)?$/);
  if (numberMatch) return numberMatch[1];

  return "N";
}

function tierLabelFromCode(code, fallbackTier) {
  const tierCode = normalizeTierCode(code, fallbackTier);
  return tierName[tierCode] || `${tierCode}티어`;
}

function normalizeAcademy(item) {
  const academy = item.academy || item.academyInfo || item.school || item.team || null;

  if (!academy) return null;

  if (typeof academy === "string") {
    return {
      id: safeKey(academy),
      name: academy,
      image: "",
      sourceImage: "",
      position: item.academyPosition || item.position || "",
    };
  }

  const image = normalizeUrl(
    academy.image ||
      academy.logoImageUrl ||
      academy.logo ||
      academy.sourceImage ||
      academy.profileImageUrl ||
      ""
  );

  return {
    id: academy.id || safeKey(academy.name || item.academyName || "academy"),
    name: academy.name || item.academyName || "",
    image,
    sourceImage: normalizeUrl(academy.sourceImage || academy.logoImageUrl || image),
    position: academy.position || item.academyPosition || item.position || "",
  };
}

function normalizeManualPlayer(item, index) {
  const userId = String(
    item.userId || item.soopUserId || item.soopId || item.stationId || item.id || ""
  ).trim();

  const name = String(item.name || item.nickname || item.nick || item.playerName || userId).trim();
  const race = normalizeRace(item.race || item.raceCode || item.species);
  const tierCode = normalizeTierCode(item.tierCode || item.tierId || item.tier, item.tierName || item.tier);
  const profileImage = normalizeUrl(
    item.image || item.profileImage || item.profileImageUrl || item.sourceImage || item.logo || ""
  );
  const eloboardKey = String(item.eloboardKey || item.eloKey || item.eloBoardKey || "").trim();
  const station = item.station || item.stationUrl || (userId ? `https://www.sooplive.com/station/${userId}` : "");

  return {
    id: item.id || userId || `manual_${index + 1}`,
    userId,
    name,
    description: item.description || item.memo || "",
    race,
    tierCode,
    tier: tierLabelFromCode(tierCode, item.tier),
    tierId: item.tierId && String(item.tierId).startsWith("tier-") ? item.tierId : `tier-${tierCode}`,
    sortOrder: Number(item.sortOrder ?? item.order ?? item.rank ?? index + 1),

    eloboardKey,
    elo: item.elo || item.eloboardUrl || eloboardUrl(eloboardKey, race),

    image: CACHE_LOCAL_ASSETS ? localPath(path.join("assets", "profile", `${userId}.jpg`)) : profileImage,
    sourceImage: profileImage,

    station,
    stationStatus: Number(item.stationStatus || 0),

    academy: normalizeAcademy(item),

    monthWinRate: item.monthWinRate != null ? Number(item.monthWinRate) : null,
    yearWinRate: item.yearWinRate != null ? Number(item.yearWinRate) : null,
    winRate: item.winRate != null ? String(item.winRate) : "",

    live: false,
    broad: null,
    broadcastUrl: "",
  };
}

async function readManualPlayers() {
  const raw = await fs.readFile(MANUAL_PLAYERS_PATH, "utf8");
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.players)
      ? parsed.players
      : Array.isArray(parsed.data)
        ? parsed.data
        : [];

  const players = list
    .map((item, index) => normalizeManualPlayer(item, index))
    .filter((player) => player.userId && player.name && player.race);

  if (players.length === 0) {
    throw new Error(`manual players empty or invalid: ${MANUAL_PLAYERS_PATH}`);
  }

  return players.sort((a, b) => {
    const aTierIndex = tierOrder.indexOf(a.tierCode);
    const bTierIndex = tierOrder.indexOf(b.tierCode);

    const tierDiff =
      (aTierIndex === -1 ? 999 : aTierIndex) -
      (bTierIndex === -1 ? 999 : bTierIndex);

    if (tierDiff !== 0) return tierDiff;

    return Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
  });
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

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripTags(html) {
  return decodeHtml(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToTextLines(html) {
  const text = decodeHtml(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/td>/gi, " ")
      .replace(/<\/th>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );

  return text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function parseOpponentCell(text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^(.+?)\s*\((T|Z|P|테란|저그|토스|프로토스)\)$/i);

  if (match) {
    return {
      opponentName: match[1].trim(),
      opponentRace: normalizeRace(match[2]),
    };
  }

  const compact = cleaned.match(/^(.+?)([TZP])$/i);

  if (compact) {
    return {
      opponentName: compact[1].trim(),
      opponentRace: normalizeRace(compact[2]),
    };
  }

  return {
    opponentName: cleaned,
    opponentRace: "",
  };
}

function makeEloboardRecord({ player, date, opponentName, opponentRace, map, eloChange, matchType, memo }) {
  const ownRace = normalizeRace(player.race);
  const numericEloChange = Number(eloChange);
  const isWin = numericEloChange > 0;

  const winnerPlayer = isWin ? player.name : opponentName;
  const winnerRace = isWin ? ownRace : opponentRace;
  const losePlayer = isWin ? opponentName : player.name;
  const loseRace = isWin ? opponentRace : ownRace;

  return {
    id: `${player.userId || player.name}_${date}_${opponentName}_${opponentRace}_${map}_${numericEloChange}_${matchType || ""}_${memo || ""}`
      .replace(/\s+/g, "_")
      .slice(0, 240),
    date,
    standardDate: date,
    playedAt: date,
    playerName: player.name,
    playerRace: ownRace,
    playerUserId: player.userId || "",
    opponentName,
    opponentRace,
    map,
    elo: numericEloChange,
    eloChange: numericEloChange,
    matchType: matchType || "",
    memo: memo || "",
    result: isWin ? "win" : "lose",
    isWin,

    winnerPlayer,
    winnerName: winnerPlayer,
    winnerRace,
    losePlayer,
    loseName: losePlayer,
    loseRace,

    winnerSoopUserId: isWin ? player.userId || "" : "",
    winnerUserId: isWin ? player.userId || "" : "",
    loseSoopUserId: isWin ? "" : player.userId || "",
    loserSoopUserId: isWin ? "" : player.userId || "",
    loseUserId: isWin ? "" : player.userId || "",
    loserUserId: isWin ? "" : player.userId || "",
  };
}

function parseEloboardRecordCells(cells, player) {
  const clean = cells
    .map((cell) => String(cell || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (clean.length < 5) return null;

  const dateMatch = clean[0].match(/\d{4}-\d{2}-\d{2}/);
  if (!dateMatch) return null;

  const eloIndex = clean.findIndex((cell, index) => index >= 3 && /^[+-]\d+(?:\.\d+)?$/.test(cell));
  if (eloIndex < 3) return null;

  const date = dateMatch[0];
  const { opponentName, opponentRace } = parseOpponentCell(clean[1]);
  const map = clean.slice(2, eloIndex).join(" ").trim();
  const numericEloChange = Number(clean[eloIndex]);
  const matchType = clean[eloIndex + 1] || "";
  const memo = clean.slice(eloIndex + 2).join(" ").trim();

  if (!opponentName || !opponentRace || !map || !Number.isFinite(numericEloChange)) return null;

  return makeEloboardRecord({
    player,
    date,
    opponentName,
    opponentRace,
    map,
    eloChange: numericEloChange,
    matchType,
    memo,
  });
}

function parseEloboardRowsByTable(html, player) {
  const records = [];
  const trRegex = /<tr\b[\s\S]*?<\/tr>/gi;
  const cellRegex = /<t[dh]\b[\s\S]*?<\/t[dh]>/gi;

  let trMatch;

  while ((trMatch = trRegex.exec(html))) {
    const rowHtml = trMatch[0];
    if (!/\d{4}-\d{2}-\d{2}/.test(rowHtml)) continue;

    const cells = [];
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowHtml))) {
      cells.push(stripTags(cellMatch[0]));
    }

    const record = parseEloboardRecordCells(cells, player);

    if (record) {
      records.push(record);
      if (records.length >= ELOBOARD_MAX_ROWS_PER_PLAYER) break;
    }
  }

  return records;
}

function parseEloboardRecordLine(line, player) {
  const compact = String(line || "").replace(/\s+/g, " ").trim();
  const match = compact.match(
    /^(\d{4}-\d{2}-\d{2})\s+(.+?)\s*\((T|Z|P|테란|저그|토스|프로토스)\)\s+(.+?)\s+([+-]\d+(?:\.\d+)?)\s+([0-9/()]+|단판)\s*(.*)$/
  );

  if (!match) return null;

  return makeEloboardRecord({
    player,
    date: match[1],
    opponentName: match[2].trim(),
    opponentRace: normalizeRace(match[3]),
    map: match[4].trim(),
    eloChange: Number(match[5]),
    matchType: match[6] || "",
    memo: match[7] || "",
  });
}

function parseEloboardRowsByText(html, player) {
  const lines = htmlToTextLines(html);
  const records = [];

  for (const line of lines) {
    if (!/^\d{4}-\d{2}-\d{2}\s+/.test(line)) continue;

    const row = parseEloboardRecordLine(line, player);

    if (row) {
      records.push(row);
      if (records.length >= ELOBOARD_MAX_ROWS_PER_PLAYER) break;
    }
  }

  return records;
}

function parseEloboardRecords(html, player) {
  const byTable = parseEloboardRowsByTable(html, player);
  if (byTable.length > 0) return byTable;

  return parseEloboardRowsByText(html, player);
}

async function fetchEloboardHtml(url) {
  const { response, body } = await fetchBodyWithTimeout(
    url,
    {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    },
    (res) => res.text()
  );

  if (!response.ok) {
    throw new Error(`${response.status} ${url}`);
  }

  return body || "";
}

async function fetchRecords(player) {
  const url = eloboardRecordUrl(player);

  if (!url) return [];

  const html = await fetchEloboardHtml(url);

  if (/max_user_connections|Too many connections|DB Connect Error/i.test(html)) {
    throw new Error("ELOBOARD connection limit page detected");
  }

  const records = parseEloboardRecords(html, player);

  if (records.length === 0) {
    console.warn(`[records warn] ${player.name}(${player.userId}/${player.race}) direct ELOBOARD parsed 0 rows`);
  }

  await sleep(250);

  return records;
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

function normalizeRecordRows(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.filter((row) => row && typeof row === "object");
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .sort(([a], [b]) => {
        const na = Number(a);
        const nb = Number(b);

        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
        return String(a).localeCompare(String(b));
      })
      .map(([, row]) => row)
      .filter((row) => row && typeof row === "object");
  }

  return [];
}

function maxRecordDateString(rows) {
  let latest = "";

  normalizeRecordRows(rows).forEach((row) => {
    const date = rowDate(row);

    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date > latest) {
      latest = date;
    }
  });

  return latest;
}

function dateMonthsAgo(now, months) {
  const value = new Date(now.getTime());
  value.setMonth(value.getMonth() - months);
  return value;
}

function isInactiveByLastRecordDate(lastRecordDate, now = new Date()) {
  if (!lastRecordDate) return true;

  const parsed = new Date(`${lastRecordDate}T00:00:00+09:00`);

  if (Number.isNaN(parsed.getTime())) return true;

  return parsed < dateMonthsAgo(now, INACTIVE_RECORD_MONTHS);
}

function sumRecordRows(records) {
  return Object.values(records || {}).reduce(
    (sum, rows) => sum + normalizeRecordRows(rows).length,
    0
  );
}
function isYouthTierPlayer(player) {
  const tierCode = normalizeTierCode(
    player.tierCode || player.tierId || player.tier,
    player.tierName || player.tier
  );

  const tierText = String(player.tier || player.tierName || "").trim();

  return (
    tierCode === "B" ||
    tierText === "베이비티어" ||
    tierText === "유스" ||
    tierText === "유스티어"
  );
}
function countRecordPlayers(records) {
  return Object.values(records || {}).filter(
    (rows) => normalizeRecordRows(rows).length > 0
  ).length;
}

async function readExistingRecordRows(rootRef, key) {
  const snap = await withRetry(`records/${key} existing read`, () =>
    rootRef.child("records").child(key).once("value")
  );

  return normalizeRecordRows(snap.val());
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
    sourcePlayerCount: metaWithPreservedLive.sourcePlayerCount,
    hiddenInactivePlayerCount: metaWithPreservedLive.hiddenInactivePlayerCount,
    liveCount: existingLiveCount,
    recordPlayerCount: metaWithPreservedLive.recordPlayerCount,
    recordRowCount: metaWithPreservedLive.recordRowCount,
    recordFailCount: metaWithPreservedLive.recordFailCount,
    recordSkipCount: metaWithPreservedLive.recordSkipCount,
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
    MANUAL_PLAYERS_PATH,
    FETCH_TIMEOUT_MS,
    RECORD_CONCURRENCY,
    RECORD_MAX_PAGES,
    ELOBOARD_MAX_ROWS_PER_PLAYER,
    INACTIVE_RECORD_MONTHS,
    HIDE_INACTIVE_PLAYERS,
    CACHE_LOCAL_JSON,
    CACHE_LOCAL_ASSETS,
  });

  console.log("[1/6] 수동 플레이어 데이터 로드 시작");

  const [manualPlayers, lastUpdated] = await Promise.all([
    readManualPlayers(),
    getJson("https://www.cnine.kr/api/v2/p/starcraft/eloboard/last-updated-at").catch(() => ({
      lastUpdatedAt: null,
    })),
  ]);

  console.log(`[manual] players loaded ${manualPlayers.length}: ${MANUAL_PLAYERS_PATH}`);

  console.log("[2/6] 선택적 이미지 캐시 처리");

  if (CACHE_LOCAL_ASSETS) {
    let imageOk = 0;

    await mapLimit(manualPlayers, 12, async (player) => {
      const target = path.join(profileDir, `${player.userId}.jpg`);
      const ok = await download(player.sourceImage || player.image, target).catch(() => false);
      if (ok) imageOk += 1;
    });

    console.log(`profile image cached: ${imageOk}/${manualPlayers.length}`);
  }

  console.log("[3/6] SOOP 방송국 상태 확인 시작");

  const stationChecks = await mapLimit(manualPlayers, 12, async (player) => {
    const station = player.station || `https://www.sooplive.com/station/${player.userId}`;

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

  const players = manualPlayers.map((player) => ({
    ...player,
    stationStatus: stationStatus.get(player.userId) || player.stationStatus || 0,
    live: false,
    broad: null,
    broadcastUrl: "",
  }));

  console.log(`[4/6] ELO 전적 수집 시작: ${players.length}명`);

  const recordsToUpload = {};
  const recordsForDerived = {};
  const fetchFailures = {};
  const fetchSkipped = {};
  let recordFetchPlayerCount = 0;
  let recordFetchRowCount = 0;
  let recordFailCount = 0;
  let recordSkipCount = 0;

  await mapLimit(players, RECORD_CONCURRENCY, async (player, index) => {
    const key = safeKey(`${player.userId}_${player.race}`);
    const url = eloboardRecordUrl(player);

    if (!url) {
      recordSkipCount += 1;
      fetchSkipped[key] = {
        player,
        reason: "no-eloboard-url",
      };
      recordsForDerived[key] = [];
      console.warn(`[records skip] ${player.name}(${player.userId}/${player.race}): ELO URL 없음`);

      if ((index + 1) % 25 === 0 || index + 1 === players.length) {
        console.log(`records ${index + 1}/${players.length}`);
      }

      return;
    }

    try {
      const rows = await fetchRecords(player);

      if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error("ELOBOARD parsed 0 rows");
      }

      recordsToUpload[key] = rows;
      recordsForDerived[key] = rows;
      recordFetchPlayerCount += 1;
      recordFetchRowCount += rows.length;

      if (CACHE_LOCAL_JSON) {
        await fs.writeFile(path.join(recordDir, `${key}.json`), JSON.stringify(rows));
      }
    } catch (error) {
      recordFailCount += 1;
      fetchFailures[key] = {
        player,
        reason: error.message,
      };
      recordsForDerived[key] = [];
      console.warn(`[records fail] ${player.name}(${player.userId}/${player.race}): ${error.message}`);
    }

    if ((index + 1) % 25 === 0 || index + 1 === players.length) {
      console.log(`records ${index + 1}/${players.length}`);
    }
  });

  const db = initFirebase();
  const rootRef = db.ref(FIREBASE_ROOT);
  const fallbackTargets = { ...fetchFailures, ...fetchSkipped };
  const recordPreserveReadFailed = {};
  let recordPreservedPlayerCount = 0;
  let recordPreservedRowCount = 0;
  let recordPreserveReadFailCount = 0;

  const fallbackEntries = Object.entries(fallbackTargets);

  if (fallbackEntries.length > 0) {
    console.log(`[4.5/6] 기존 Firebase 전적 보존 확인: ${fallbackEntries.length}명`);

    await mapLimit(fallbackEntries, RECORD_CONCURRENCY, async ([key, item]) => {
      const existingRows = await readExistingRecordRows(rootRef, key).catch((error) => {
        recordPreserveReadFailed[key] = true;
        recordPreserveReadFailCount += 1;
        console.warn(
          `[records preserve fail] ${item.player.name}(${item.player.userId}/${item.player.race}): ${error.message}`
        );
        return [];
      });

      if (existingRows.length > 0) {
        recordsForDerived[key] = existingRows;
        recordPreservedPlayerCount += 1;
        recordPreservedRowCount += existingRows.length;

        if (CACHE_LOCAL_JSON) {
          await fs.writeFile(path.join(recordDir, `${key}.json`), JSON.stringify(existingRows));
        }

        console.log(
          `[records preserve] ${item.player.name}(${item.player.userId}/${item.player.race}) existing ${existingRows.length} rows kept`
        );
      }
    });
  }

  console.log("[5/6] Firebase 업로드 데이터 구성");

  const activityNow = new Date();
  const playersWithRecordStatus = players.map((player) => {
    const key = safeKey(`${player.userId}_${player.race}`);
    const rows = normalizeRecordRows(recordsForDerived[key]);
    const lastRecordDate = maxRecordDateString(rows);
    const preserveReadFailed = recordPreserveReadFailed[key] === true;
   const youthTierExempt = isYouthTierPlayer(player);
   const recordInactive = youthTierExempt
  ? false
  : preserveReadFailed && rows.length === 0
    ? false
    : isInactiveByLastRecordDate(lastRecordDate, activityNow);
   return {
    ...player,
    recordKey: key,
    recordCount: rows.length,
    lastRecordDate,
    recordInactive,
    recordInactiveExempt: youthTierExempt ? "youth-tier" : "",
    recordPreserveReadFailed: preserveReadFailed,
    hiddenByRecordInactivity: HIDE_INACTIVE_PLAYERS && recordInactive,
    recordVisibility: HIDE_INACTIVE_PLAYERS && recordInactive ? "hidden-inactive-records" : "visible",
  };
});

  const visiblePlayers = HIDE_INACTIVE_PLAYERS
    ? playersWithRecordStatus.filter((player) => !player.hiddenByRecordInactivity)
    : playersWithRecordStatus;

  const hiddenInactivePlayers = playersWithRecordStatus.filter(
    (player) => player.hiddenByRecordInactivity
  );

  const winRates = buildWinRates(visiblePlayers);
  const headToHead = buildHeadToHead(visiblePlayers, recordsForDerived);

  const nowIso = new Date().toISOString();
  const recordPlayerCount = countRecordPlayers(recordsForDerived);
  const recordRowCount = sumRecordRows(recordsForDerived);
  const recordUploadPlayerCount = countRecordPlayers(recordsToUpload);
  const recordUploadRowCount = sumRecordRows(recordsToUpload);

  const meta = {
    collectedAt: nowIso,
    syncedAt: nowIso,
    updatedAt: nowIso,
    sourceLastUpdatedAt: lastUpdated.lastUpdatedAt || null,
    eloboardUpdatedAt: lastUpdated.lastUpdatedAt || null,
    playerCount: visiblePlayers.length,
    sourcePlayerCount: players.length,
    hiddenInactivePlayerCount: hiddenInactivePlayers.length,
    hiddenInactivePlayers: hiddenInactivePlayers.map((player) => ({
      userId: player.userId,
      name: player.name,
      race: player.race,
      tier: player.tier,
      lastRecordDate: player.lastRecordDate,
      recordCount: player.recordCount,
    })),
    hideInactivePlayers: HIDE_INACTIVE_PLAYERS,
    inactiveRecordMonths: INACTIVE_RECORD_MONTHS,
    liveCount: 0,
    stationVisitedCount: stationChecks.filter((item) => item.status >= 200 && item.status < 400).length,
    recordPlayerCount,
    recordRowCount,
    recordFetchPlayerCount,
    recordFetchRowCount,
    recordPreservedPlayerCount,
    recordPreservedRowCount,
    recordPreserveReadFailCount,
    recordUploadPlayerCount,
    recordUploadRowCount,
    recordFailCount,
    recordSkipCount,
    headToHeadCount: Object.keys(headToHead).length,
    fetchTimeoutMs: FETCH_TIMEOUT_MS,
    recordConcurrency: RECORD_CONCURRENCY,
    recordMaxPages: RECORD_MAX_PAGES,
    eloboardMaxRowsPerPlayer: ELOBOARD_MAX_ROWS_PER_PLAYER,
    source: "manual-players + direct-eloboard",
    playerSource: "data/manual/players.json",
    liveSource: "preserved-from-soop-sync",
  };

  const payload = {
    meta,
    players: visiblePlayers,
    records: recordsToUpload,
    winRates,
    headToHead,
  };

  if (CACHE_LOCAL_JSON) {
    await fs.writeFile(path.join(dataDir, "players.json"), JSON.stringify({ meta, players: visiblePlayers }, null, 2));
    await fs.writeFile(path.join(dataDir, "records.json"), JSON.stringify(recordsForDerived));
    await fs.writeFile(path.join(dataDir, "records-upload.json"), JSON.stringify(recordsToUpload));
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
