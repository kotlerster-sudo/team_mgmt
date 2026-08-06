/**
 * Shared per-assembly auth helper.
 *
 * Rules:
 *   - super-admin can always access every assembly (RP).
 *   - partner can access only assemblies where partner_user_id = their user id.
 *   - anyone else → 403.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/roleGuard';
import { getAssembly, getAssemblyForPartnerUser, type AssemblyListRow, type AssemblyRow } from './repo';

export type AssemblyAuth =
  | { ok: true; assembly: AssemblyRow | AssemblyListRow; actorUserId: string; isPartner: boolean }
  | { ok: false; response: Response };

export async function authAssembly(id: string): Promise<AssemblyAuth> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }) };
  }
  const actorUserId = session.user.id;

  if (isSuperAdmin(session)) {
    const asm = await getAssembly(id);
    if (!asm) {
      return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
    }
    return { ok: true, assembly: asm, actorUserId, isPartner: false };
  }

  if (session.user.role === 'partner') {
    const asm = await getAssemblyForPartnerUser(id, actorUserId);
    if (!asm) {
      return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
    }
    return { ok: true, assembly: asm, actorUserId, isPartner: true };
  }

  return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
}
