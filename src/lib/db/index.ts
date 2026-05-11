import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

// DB URL resolution order:
//   1. DATABASE_URL — preferred. Set this to `file:/data/app.db` to use a
//      Railway persistent volume mounted at /data, or to any libsql/Turso
//      URL for hosted Turso.
//   2. TURSO_DATABASE_URL — legacy hosted-Turso var, kept for back-compat.
//   3. file:sqlite.db — local dev fallback. Do not use in prod; Railway
//      containers are ephemeral and the file is wiped on every redeploy.
export function resolveDbConfig() {
  let url =
    process.env.DATABASE_URL ||
    process.env.TURSO_DATABASE_URL ||
    "file:sqlite.db";
  // During `next build` (page-data collection), the Railway volume isn't
  // mounted yet, so file:/data/app.db can't be opened (SQLITE_CANTOPEN, 14).
  // Substitute a build-only tmp file so route module init succeeds. At
  // runtime NEXT_PHASE is unset and the real path is used.
  if (
    process.env.NEXT_PHASE === "phase-production-build" &&
    url.startsWith("file:/data/")
  ) {
    url = "file:.next-build-shim.db";
  }
  return {
    url,
    authToken:
      process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN,
  };
}

export function createRawDbClient() {
  return createClient(resolveDbConfig());
}

const client = createRawDbClient();

export const db = drizzle(client, { schema });
