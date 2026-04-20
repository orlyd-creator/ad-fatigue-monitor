import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * /leads was merged into /strategy (now labelled "Leads & Analytics") on
 * 2026-04-20. Any old bookmark or deep-link lands here and is redirected
 * with ALL its query params preserved (including compareFrom/compareTo)
 * so date range and comparison selections survive.
 */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) || {};
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string" && v) qs.set(k, v);
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  redirect(`/strategy${suffix}`);
}
