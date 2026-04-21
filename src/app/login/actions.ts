"use server";

import { signIn, signOut } from "@/lib/auth";

export async function signInWithFacebook() {
  await signIn("facebook", { redirectTo: "/executive" });
}

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/executive" });
}

export async function signOutUser() {
  await signOut({ redirectTo: "/login?fresh=1" });
}
