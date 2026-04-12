const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(__dirname, "..", "sqlite.db");
const db = new Database(dbPath);

// Check if column already exists
const columns = db.pragma("table_info(ads)");
const hasThumbnailUrl = columns.some((c) => c.name === "thumbnail_url");

if (hasThumbnailUrl) {
  console.log("Column 'thumbnail_url' already exists on ads table. Skipping.");
} else {
  db.exec("ALTER TABLE ads ADD COLUMN thumbnail_url TEXT");
  console.log("Added 'thumbnail_url' column to ads table.");
}

db.close();
