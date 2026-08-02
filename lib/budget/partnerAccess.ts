// Access model for external grantee "partner" logins. A partner is a User with
// role "partner" linked (via GrantPartnerUser) to exactly one grantee org. They
// may read + report on budgets whose grantPartnerId matches that org. An org can
// hold several such logins; a login belongs to one org.

import prisma from "@/lib/prisma";

type SessionLike = { user?: { id?: string; role?: string } } | null;

export type PartnerAccess = {
  userId: string | null;
  isPartner: boolean;
  grantPartnerId: string | null;
};

export async function getPartnerAccess(session: SessionLike): Promise<PartnerAccess> {
  const userId = session?.user?.id ?? null;
  const isPartner = session?.user?.role === "partner";
  if (!userId || !isPartner) return { userId, isPartner: false, grantPartnerId: null };
  const link = await prisma.grantPartnerUser.findUnique({ where: { userId }, select: { grantPartnerId: true } });
  return { userId, isPartner: true, grantPartnerId: link?.grantPartnerId ?? null };
}

/** True only for a partner whose linked grantee owns this budget. */
export function partnerCanAccessBudget(
  access: PartnerAccess,
  budget: { grantPartnerId: string | null },
): boolean {
  return access.isPartner && !!access.grantPartnerId && budget.grantPartnerId === access.grantPartnerId;
}
