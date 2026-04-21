import { redirect } from "next/navigation";

export default function Home() {
  // Default landing = Executive. Orly wants the top-level summary as
  // the first thing anyone sees on page load.
  redirect("/executive");
}
