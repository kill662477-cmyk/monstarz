const fs = require("fs/promises");
const path = require("path");
const admin = require("firebase-admin");

const root = path.resolve(__dirname, "..");
const manualDir = path.join(root, "data", "manual");
const manualPlayersPath = path.join(manualDir, "players.json");

const FIREBASE_DATABASE_URL =
  process.env.FIREBASE_DATABASE_URL ||
  "https://jddcontens-default-rtdb.asia-southeast1.firebasedatabase.app";

const FIREBASE_TIER_ROOT = process.env.FIREBASE_TIER_ROOT || "starcraftTier/current";

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

function normalizeManualPlayer(player, index) {
  return {
    id: player.id ?? null,
    userId: player.userId || "",
    name: player.name || "",
    description: player.description || "",
    race: player.race || "",
    tierCode: player.tierCode || "",
    tier: player.tier || "",
    tierId: player.tierId || "",
    sortOrder: Number(player.sortOrder ?? index + 1),

    eloboardKey: player.eloboardKey || "",
    elo: player.elo || "",

    image: player.sourceImage || player.image || "",
    sourceImage: player.sourceImage || player.image || "",

    station: player.station || (player.userId ? `https://www.sooplive.com/station/${player.userId}` : ""),
    stationStatus: player.stationStatus || 0,

    academy: player.academy
      ? {
          id: player.academy.id ?? null,
          name: player.academy.name || "",
          image: player.academy.sourceImage || player.academy.image || "",
          sourceImage: player.academy.sourceImage || player.academy.image || "",
          position: player.academy.position || "",
        }
      : null,

    monthWinRate: player.monthWinRate ?? null,
    yearWinRate: player.yearWinRate ?? null,
    winRate: player.winRate || "",
  };
}

async function main() {
  console.log(`[firebase] read ${FIREBASE_TIER_ROOT}/players`);

  const db = initFirebase();
  const snapshot = await db.ref(`${FIREBASE_TIER_ROOT}/players`).get();
  const value = snapshot.val();

  if (!value) {
    throw new Error(`${FIREBASE_TIER_ROOT}/players is empty`);
  }

  const players = Array.isArray(value) ? value : Object.values(value);

  const manualPlayers = players
    .filter((player) => player && player.userId)
    .map(normalizeManualPlayer)
    .sort((a, b) => {
      const sortA = Number(a.sortOrder || 0);
      const sortB = Number(b.sortOrder || 0);

      if (sortA !== sortB) return sortA - sortB;

      return String(a.name).localeCompare(String(b.name), "ko");
    });

  await fs.mkdir(manualDir, { recursive: true });

  await fs.writeFile(
    manualPlayersPath,
    `${JSON.stringify(manualPlayers, null, 2)}\n`,
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        path: "data/manual/players.json",
        count: manualPlayers.length,
      },
      null,
      2
    )
  );
}

main()
  .then(async () => {
    await closeFirebase();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await closeFirebase();
    process.exit(1);
  });
