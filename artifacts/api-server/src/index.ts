import app from "./app";
import { logger } from "./lib/logger";
import { installDatabaseProtections } from "./install-security";
import { BUILD_ID } from "./lib/build-identity";
import { PROXY_TRUST } from "./lib/proxy-trust";

logger.info({ build: BUILD_ID }, "HWD API build");
logger.info({ trustedProxyHops: PROXY_TRUST.hops, source: PROXY_TRUST.source, reason: PROXY_TRUST.reason },
  "Proxy trust configuration");

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

await installDatabaseProtections();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
