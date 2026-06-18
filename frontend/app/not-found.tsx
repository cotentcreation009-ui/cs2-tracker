import Link from "next/link";
import { Notice } from "@/components/Notice";

export default function NotFound() {
  return (
    <Notice title="Page not found">
      That page doesn&apos;t exist. Head back to the{" "}
      <Link href="/" className="text-brand hover:underline">
        home page
      </Link>{" "}
      and search for a player.
    </Notice>
  );
}
