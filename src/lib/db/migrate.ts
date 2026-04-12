import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:sqlite.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const db = drizzle(client);

async function main() {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Database migrated successfully");
  client.close();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
