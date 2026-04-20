import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { teamInvites } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import TeamClient from "./TeamClient";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const invites = await db
    .select()
    .from(teamInvites)
    .orderBy(desc(teamInvites.invitedAt))
    .all();

  return (
    <div className="min-h-screen">
      <TeamClient initialInvites={invites} />
    </div>
  );
}
