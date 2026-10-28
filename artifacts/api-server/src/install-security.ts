import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
if (process.env.NODE_ENV === "production") throw new Error("Never write to production");
const host = new URL(process.env.DATABASE_URL!).hostname;
logger.info({ environment: "development", configuredHost: host }, "Confirming database target before security installation");
const connection = await pool.connect();
try {
  const result = await connection.query("SELECT inet_server_addr()::text AS server_address, current_database() AS database_name");
  logger.info(result.rows[0], "Observed database connection by query");
  await connection.query(await readFile(new URL("../../../lib/db/security.sql", import.meta.url), "utf8"));
  logger.info("Append-only audit and retained-record protections installed");
} finally { connection.release(); await pool.end(); }
