import { db } from "@workspace/db";
import { checkRoster, redeemRosterTicket } from "./roster";
import { sendSignInLink } from "./email";
import { privateStorage } from "./private-storage";
export interface Services {
  db: typeof db;
  roster: typeof checkRoster;
  redeemTicket: typeof redeemRosterTicket;
  email: typeof sendSignInLink;
  storage: typeof privateStorage;
  now: () => Date;
  importFetch?: typeof fetch;
}
export const defaultServices: Services = { db, roster: checkRoster, redeemTicket: redeemRosterTicket, email: sendSignInLink,
  storage: privateStorage, now: () => new Date() };
