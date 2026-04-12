"use server";

import { signIn } from "@/lib/auth";

export async function signInWithFacebook() {
  await signIn("facebook", { redirectTo: "/dashboard" });
}
