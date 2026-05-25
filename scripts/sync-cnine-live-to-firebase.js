const DATABASE_URL = (process.env.FIREBASE_DATABASE_URL || "https://jddcontens-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/$/, "");
const ROOT = process.env.FIREBASE_TIER_ROOT || "starcraftTier/current";
const AUTH = process.env.FIREBASE_AUTH || "";
const CNINE_BROAD_URL = "https://www.cnine.kr/api/v2/p/starcraft/soop/player/broad?";

function firebaseUrl(path) {
  const auth = AUTH ? `?auth=${encodeURIComponent(AUTH)}` : "";
  return `${DATABASE_URL}/${path.split("/").map(encodeURIComponent).join("/")}.json${auth}`;
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "application/json,text/plain,*/*",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function writeFirebase(path, value, method = "PUT") {
  const response = await fetch(firebaseUrl(path), {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error(`${response.status} Firebase ${path}`);
  return response.json();
}

async function main() {
  const checkedAt = new Date().toISOString();
  const rows = await getJson(CNINE_BROAD_URL);
  const liveStatus = {
    __source: "cnine",
    __checkedAt: checkedAt,
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row.userId) continue;
    liveStatus[row.userId] = {
      live: true,
      broadNo: row.broadNo || "",
      title: row.broadTitle || "",
      startedAt: row.broadStartAt || "",
      categoryTags: row.categoryTags || [],
      totalViewCount: row.totalViewCount || 0,
      broadcastUrl: row.broadNo ? `https://play.sooplive.com/${row.userId}/${row.broadNo}` : `https://play.sooplive.com/${row.userId}`,
      checkedAt,
    };
  }

  if (process.env.DRY_RUN === "1") {
    console.log(JSON.stringify({
      checkedAt,
      liveCount: Object.keys(liveStatus).filter((key) => !key.startsWith("__")).length,
      sample: Object.entries(liveStatus).filter(([key]) => !key.startsWith("__")).slice(0, 3),
    }, null, 2));
    return;
  }

  await writeFirebase(`${ROOT}/liveStatus`, liveStatus);
  await writeFirebase(`${ROOT}/meta`, {
    liveSource: "cnine",
    liveCheckedAt: checkedAt,
    liveCount: Object.keys(liveStatus).filter((key) => !key.startsWith("__")).length,
  }, "PATCH");

  console.log(`CNINE live synced: ${Object.keys(liveStatus).filter((key) => !key.startsWith("__")).length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
