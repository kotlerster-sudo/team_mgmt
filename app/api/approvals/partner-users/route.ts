/**
 * List candidate partner users for the Step 0 invite picker.
 * Restricted to super-admin so we don't leak the partner roster.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/roleGuard';
import prisma from '@/lib/prisma';

export async function GET() {
  const session = await auth();
  if (!isSuperAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    where: { role: 'partner' },
    select: {
      id: true,
      name: true,
      email: true,
      granteeLogin: { select: { grantPartner: { select: { id: true, name: true, city: true } } } },
    },
    orderBy: [{ email: 'asc' }],
  });

  return NextResponse.json({ users });
}
