"use server";

import { signIn, signOut } from "@/lib/auth";

export async function signInWithFacebook() {
  await signIn("facebook", { redirectTo: "/dashboard" });
}

export async function signOutUser() {
  await signOut({ redirectTo: "/login?fresh=1" });
}
