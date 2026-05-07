import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createRawDbClient } from "./index";

const client = createRawDbClient();
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
