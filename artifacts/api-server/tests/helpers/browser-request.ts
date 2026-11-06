import request from "supertest";

// Test clients must explicitly model browser write headers. Negative guard tests
// use raw Supertest or unset/override this header; production has no test bypass.
export default function browserRequest(app: Parameters<typeof request>[0]) {
  const client = request(app);
  for (const method of ["post", "put", "patch", "delete"] as const) {
    const original = client[method].bind(client);
    client[method] = ((...args: Parameters<typeof original>) =>
      original(...args).set("Origin", process.env.APP_ORIGIN!)) as typeof client[typeof method];
  }
  return client;
}
