import { db } from "@workspace/db";
import { checkRoster } from "./roster";
import { sendSignInLink } from "./email";
import { privateStorage } from "./private-storage";
export interface Services {
  db: typeof db;
  roster: typeof checkRoster;
  email: typeof sendSignInLink;
  storage: typeof privateStorage;
  now: () => Date;
}
export const defaultServices: Services = { db, roster: checkRoster, email: sendSignInLink,
  storage: privateStorage, now: () => new Date() };
