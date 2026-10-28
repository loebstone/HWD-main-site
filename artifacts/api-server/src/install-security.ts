import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";

async function readSecuritySql(): Promise<string> {
  try {
    return await readFile(new URL("./security.sql", import.meta.url), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // Source-mode tests and development scripts read the checked-in source file.
    return readFile(new URL("../../../lib/db/security.sql", import.meta.url), "utf8");
  }
}

export async function installDatabaseProtections(target: Pool = pool): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required before installing HWD database protections");
  const host = new URL(databaseUrl).hostname;
  logger.info({ environment: process.env.NODE_ENV ?? "development", databaseHost: host },
    "Installing idempotent HWD database protections");
  const connection = await target.connect();
  try {
    await connection.query("BEGIN");
    const source = await readSecuritySql();
    await connection.query(source);
    await connection.query("COMMIT");
    logger.info("HWD database protections are installed");
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

if (process.env.RUN_SECURITY_INSTALL === "dev") {
  if (process.env.NODE_ENV === "production") throw new Error("Manual security installer is development-only");
  await installDatabaseProtections();
  await pool.end();
}
