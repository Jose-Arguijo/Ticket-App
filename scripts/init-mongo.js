const { MongoClient } = require("mongodb");
const path = require("path");

const { createSeedDb, MONGODB_STATE_ID } = require(path.join(__dirname, "..", "server"));

const URI = process.env.MONGODB_URI || process.argv[2];
const DB_NAME = process.env.MONGODB_DB || "ticket_app";
const COLLECTION_NAME = process.env.MONGODB_COLLECTION || "app_state";

if (!URI) {
  console.error("Missing MongoDB connection string. Set MONGODB_URI or pass it as the first argument.");
  console.error("Example: node scripts/init-mongo.js \"mongodb+srv://user:pass@cluster.mongodb.net\"");
  process.exit(1);
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function run() {
  const client = new MongoClient(URI, {
    appName: "ticket-paperwork-app-init",
    serverSelectionTimeoutMS: positiveNumber(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS, 10000),
    connectTimeoutMS: positiveNumber(process.env.MONGODB_CONNECT_TIMEOUT_MS, 10000)
  });

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    const seed = createSeedDb();
    const result = await collection.updateOne(
      { _id: MONGODB_STATE_ID },
      { $setOnInsert: { _id: MONGODB_STATE_ID, ...seed } },
      { upsert: true }
    );

    if (!result.upsertedId) {
      console.log(`MongoDB is already initialized in database '${DB_NAME}', collection '${COLLECTION_NAME}'.`);
      return;
    }

    console.log(`Initialized MongoDB database '${DB_NAME}' in collection '${COLLECTION_NAME}'.`);
    console.log(`Seed document with _id='${MONGODB_STATE_ID}' has been created.`);
  } finally {
    await client.close();
  }
}

run().catch((error) => {
  console.error("Failed to initialize MongoDB:", error);
  process.exit(1);
});
