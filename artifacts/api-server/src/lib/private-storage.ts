import { Storage } from "@google-cloud/storage";
import { randomUUID } from "node:crypto";
import { required } from "./config";
import type { Readable } from "node:stream";

// Replit sidecar authentication, identical to the App Storage service template.
const client = new Storage({
  credentials: {
    audience: "replit", subject_token_type: "access_token",
    token_url: "http://127.0.0.1:1106/token", type: "external_account",
    credential_source: { url: "http://127.0.0.1:1106/credential", format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});
function file(key: string) {
  if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error("Invalid private object key");
  const path = required("PRIVATE_OBJECT_DIR").replace(/^\/|\/$/g, "");
  const [bucket, ...prefix] = path.split("/");
  if (!bucket || !prefix.length) throw new Error("PRIVATE_OBJECT_DIR is invalid");
  return client.bucket(bucket).file(`${prefix.join("/")}/documents/${key}`);
}
export interface PrivateStorage {
  save(bytes: Buffer): Promise<string>;
  read(key: string): Promise<Readable>;
}
export const privateStorage: PrivateStorage = {
  async save(bytes) {
    const key = randomUUID();
    await file(key).save(bytes, { resumable: false, contentType: "application/pdf",
      metadata: { cacheControl: "no-store", metadata: { visibility: "private" } } });
    return key;
  },
  async read(key) {
    const object = file(key);
    const [exists] = await object.exists();
    if (!exists) throw new Error("Private document is unavailable");
    return object.createReadStream();
  },
};
