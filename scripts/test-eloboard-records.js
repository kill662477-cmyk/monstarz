const fs = require("fs/promises");
const path = require("path");

const root = path.resolve(__dirname, "..");
const manualPlayersPath = path.join(root, "data", "manual", "players.json");
const outputPath = path.join(root, "data", "test-eloboard-records.json");
const debugDir = path.join(root, "data", "debug-eloboard");

const FETCH_TIMEOUT_MS = Math.max(3000, Number(process.env.FETCH_TIMEOUT_MS || 20000));
const TEST_LIMIT = Math.max(1, Number(process.env.TEST_LIMIT || 5));
const MAX_ROWS_PER_PLAYER = Math.max(1, Number(process.env.MAX_ROWS_PER_PLAYER || 30));
const SAVE_DEBUG_HTML = process.env.SAVE_DEBUG_HTML === "true";

const TEST_NAMES = String(process.env.TEST_NAMES || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

function normalizeUrl(url) {
  if (!url) return "";
  const value = String(url);
  if (value.startsWith("//")) return `https:${value}`;
  return value;
}

function safeFileName(value) {
  return String(value || "unknown").replace(/[\\/:*?"<>|\s]+/g, "_");
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

async function fetchTextWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      signal: controller.signal,
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`${response.status} ${url}`);
    }

    return text;
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(`timeout after ${FETCH_TIMEOUT_MS}ms: ${url}`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
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
  ).replace(/\s+/g, " ").trim();
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

function normalizeRace(value) {
  const text = String(value || "").trim().toUpperCase();

  if (text === "T" || /테란|TERRAN/.test(text)) return "T";
  if (text === "Z" || /저그|ZERG/.test(text)) return "Z";
  if (text === "P" || /토스|프로토스|PROTOSS/.test(text)) return "P";

  return text.slice(0, 1);
}

function makeRecord({ player, date, opponentName, opponentRace, map, eloChange, matchType, memo }) {
  const ownRace = normalizeRace(player.race);
  const isWin = Number(eloChange) > 0;

  const winnerPlayer = isWin ? player.name : opponentName;
  const winnerRace = isWin ? ownRace : opponentRace;
  const losePlayer = isWin ? opponentName : player.name;
  const loseRace = isWin ? opponentRace : ownRace;

  return {
    id: `${player.userId || player.name}_${date}_${opponentName}_${opponentRace}_${map}_${eloChange}_${matchType}_${memo}`
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
    elo: Number(eloChange),
    eloChange: Number(eloChange),
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

function parseRecordCells(cells, player) {
  const clean = cells.map((cell) => String(cell || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (clean.length < 5) return null;

  const dateMatch = clean[0].match(/\d{4}-\d{2}-\d{2}/);
  if (!dateMatch) return null;

  const eloIndex = clean.findIndex((cell, index) => index >= 3 && /^[+-]\d+(?:\.\d+)?$/.test(cell));
  if (eloIndex < 3) return null;

  const date = dateMatch[0];
  const { opponentName, opponentRace } = parseOpponentCell(clean[1]);
  const map = clean.slice(2, eloIndex).join(" ").trim();
  const eloChange = Number(clean[eloIndex]);
  const matchType = clean[eloIndex + 1] || "";
  const memo = clean.slice(eloIndex + 2).join(" ").trim();

  if (!opponentName || !opponentRace || !map || !Number.isFinite(eloChange)) return null;

  return makeRecord({
    player,
    date,
    opponentName,
    opponentRace,
    map,
    eloChange,
    matchType,
    memo,
  });
}

function parseRowsByTable(html, player) {
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

    const record = parseRecordCells(cells, player);
    if (record) {
      records.push(record);
      if (records.length >= MAX_ROWS_PER_PLAYER) break;
    }
  }

  return records;
}

function parseRecordLine(line, player) {
  const compact = String(line || "").replace(/\s+/g, " ").trim();
  const match = compact.match(
    /^(\d{4}-\d{2}-\d{2})\s+(.+?)\s*\((T|Z|P|테란|저그|토스|프로토스)\)\s+(.+?)\s+([+-]\d+(?:\.\d+)?)\s+([0-9/()]+|단판)\s*(.*)$/
  );

  if (!match) return null;

  return makeRecord({
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

function parseRowsByText(html, player) {
  const lines = htmlToTextLines(html);
  const records = [];

  for (const line of lines) {
    if (!/^\d{4}-\d{2}-\d{2}\s+/.test(line)) continue;

    const row = parseRecordLine(line, player);

    if (row) {
      records.push(row);
      if (records.length >= MAX_ROWS_PER_PLAYER) break;
    }
  }

  return records;
}

function findDebugLines(html) {
  return htmlToTextLines(html)
    .filter((line) => /\d{4}-\d{2}-\d{2}/.test(line) || /날짜\s+상대\s+맵\s+ELO/.test(line))
    .slice(0, 30);
}

function parseEloboardRecords(html, player) {
  const byTable = parseRowsByTable(html, player);
  if (byTable.length > 0) return byTable;

  return parseRowsByText(html, player);
}

async function readManualPlayers() {
  const raw = await fs.readFile(manualPlayersPath, "utf8");
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed) ? parsed : parsed.players || parsed.data || [];

  return list
    .map((item) => {
      const race = normalizeRace(item.race || item.playerRace || item.mainRace);
      const userId = item.userId || item.soopUserId || item.soopId || item.id || "";
      const name = item.name || item.nickname || item.nick || userId;
      const eloboardKey = item.eloboardKey || item.eloKey || "";
      const elo =
        item.elo ||
        item.eloboard ||
        item.eloboardUrl ||
        item.eloUrl ||
        eloboardUrl(eloboardKey, race);

      return {
        ...item,
        userId,
        name,
        race,
        eloboardKey,
        elo: normalizeUrl(elo),
      };
    })
    .filter((player) => player.name && player.race && player.elo);
}

function selectTestPlayers(players) {
  if (TEST_NAMES.length > 0) {
    const selected = [];

    for (const keyword of TEST_NAMES) {
      const found =
        players.find((player) => player.name === keyword || player.userId === keyword) ||
        players.find((player) => player.name.includes(keyword) || player.userId.includes(keyword));

      if (found && !selected.some((item) => item.userId === found.userId && item.race === found.race)) {
        selected.push(found);
      }
    }

    return selected;
  }

  return players.slice(0, TEST_LIMIT);
}

async function main() {
  console.log("[test] read manual players:", manualPlayersPath);

  const players = await readManualPlayers();
  const targets = selectTestPlayers(players);

  if (targets.length === 0) {
    throw new Error("No test players selected. Check TEST_NAMES or data/manual/players.json.");
  }

  console.log(`[test] loaded players with ELO URL: ${players.length}`);
  console.log(`[test] targets: ${targets.map((p) => `${p.name}/${p.race}`).join(", ")}`);

  const report = {
    generatedAt: new Date().toISOString(),
    maxRowsPerPlayer: MAX_ROWS_PER_PLAYER,
    targets: [],
  };

  await fs.mkdir(debugDir, { recursive: true });

  for (const player of targets) {
    console.log("");
    console.log(`[test] fetch ${player.name}/${player.race}: ${player.elo}`);

    try {
      const html = await fetchTextWithTimeout(player.elo);

      if (SAVE_DEBUG_HTML) {
        await fs.writeFile(path.join(debugDir, `${safeFileName(player.name)}_${player.race}.html`), html);
      }

      if (/max_user_connections|Too many connections|DB Connect Error/i.test(html)) {
        throw new Error("ELOBOARD connection limit page detected");
      }

      const rows = parseEloboardRecords(html, player);
      const debugLines = rows.length === 0 ? findDebugLines(html) : [];

      console.log(`[test] parsed rows: ${rows.length}`);

      if (rows.length === 0) {
        console.log("[test] debug date lines:");
        debugLines.slice(0, 10).forEach((line, index) => {
          console.log(`  line ${index + 1}: ${line}`);
        });
      }

      rows.slice(0, 5).forEach((row, index) => {
        console.log(
          `  ${index + 1}. ${row.date} vs ${row.opponentName}(${row.opponentRace}) ${row.map} ${row.eloChange} ${row.result} / ${row.matchType} ${row.memo}`
        );
      });

      report.targets.push({
        userId: player.userId,
        name: player.name,
        race: player.race,
        url: player.elo,
        ok: rows.length > 0,
        count: rows.length,
        sample: rows.slice(0, 10),
        debugLines,
      });
    } catch (error) {
      console.warn(`[test] failed ${player.name}/${player.race}: ${error.message}`);

      report.targets.push({
        userId: player.userId,
        name: player.name,
        race: player.race,
        url: player.elo,
        ok: false,
        error: error.message,
      });
    }

    await sleep(1000);
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2));

  const okCount = report.targets.filter((item) => item.ok).length;
  const failCount = report.targets.length - okCount;

  console.log("");
  console.log(`[test] done. ok=${okCount}, fail=${failCount}`);
  console.log(`[test] report written: ${outputPath}`);

  if (okCount === 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
