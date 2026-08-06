"use client";

/**
 * URL-backed state for /command — every axis lives in searchParams so any
 * drill position is shareable / bookmarkable:
 *
 *   ?zone=<zoneId>&lens=geo|rp|prog&view=tree|visits|setup
 *   &sel=<goalId>&month=YYYY-MM
 */

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type CommandLens = "geo" | "rp" | "prog";
export type CommandView = "tree" | "visits" | "setup";

export type CommandState = {
  zoneId: string;
  lens: CommandLens;
  view: CommandView;
  sel: string | null;
  /** null = current month. */
  month: string | null;
};

const LENSES: CommandLens[] = ["geo", "rp", "prog"];
const VIEWS: CommandView[] = ["tree", "visits", "setup"];

export function useCommandState(defaultZoneId: string) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const state: CommandState = useMemo(() => {
    const lens = params.get("lens") as CommandLens | null;
    const view = params.get("view") as CommandView | null;
    const month = params.get("month");
    return {
      zoneId: params.get("zone") ?? defaultZoneId,
      lens: lens && LENSES.includes(lens) ? lens : "geo",
      view: view && VIEWS.includes(view) ? view : "tree",
      sel: params.get("sel"),
      month: month && /^\d{4}-\d{2}$/.test(month) ? month : null,
    };
  }, [params, defaultZoneId]);

  const update = useCallback(
    (patch: Partial<CommandState>) => {
      const next = new URLSearchParams(params.toString());
      const setOrDelete = (key: string, value: string | null | undefined, defaultValue?: string) => {
        if (value === undefined) return;
        if (value === null || value === defaultValue) next.delete(key);
        else next.set(key, value);
      };
      setOrDelete("zone", patch.zoneId, defaultZoneId);
      setOrDelete("lens", patch.lens, "geo");
      setOrDelete("view", patch.view, "tree");
      setOrDelete("sel", patch.sel);
      setOrDelete("month", patch.month);
      // Changing zone resets the selection (the row no longer exists in scope).
      if (patch.zoneId !== undefined && patch.sel === undefined) next.delete("sel");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router, defaultZoneId],
  );

  return { state, update };
}
