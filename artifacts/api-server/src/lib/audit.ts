import { db, auditLog, type SiteIdentity } from "@workspace/db";
type Writer = Pick<typeof db, "insert">;
export async function audit(writer: Writer, actor: Pick<SiteIdentity, "personId" | "displayName">, action: string,
  targetId: string | null, description: string, address: string, at?: Date): Promise<void> {
  await writer.insert(auditLog).values({ actorPersonId: actor.personId, actorName: actor.displayName,
    action, targetId, description, visitorAddress: address, ...(at ? { at } : {}) });
}
