import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * /leads was merged into /strategy (now labelled "Leads & Analytics") on
 * 2026-04-20. Any old bookmark or deep-link lands here and is redirected
 * with its query params preserved so the date range still applies.
 */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams?: Promise<{ from?: string; to?: string }>;
}) {
  const params = (await searchParams) || {};
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  redirect(`/strategy${suffix}`);
}
