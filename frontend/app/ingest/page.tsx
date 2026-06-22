import type { Metadata } from "next";
import { IngestForm } from "@/components/IngestForm";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Ingest a demo — CS2 Tracker",
};

// Reads the session cookie to show ingest attribution, so render per-request.
export const dynamic = "force-dynamic";

export default async function IngestPage() {
  const session = await getSession();
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold">Ingest a demo</h1>
      <p className="mt-1 text-sm text-muted">
        Queue a CS2 <code className="text-ink">.dem</code> for parsing and watch
        it land. Provide a server-side file path, a direct{" "}
        <code className="text-ink">.dem(.bz2)</code> URL, or a match share code.
        Parsing runs on a worker, so this page polls the job until it finishes.
      </p>
      <div className="mt-5">
        <IngestForm signedInAs={session?.personaName || session?.steamId64 || null} />
      </div>
    </div>
  );
}
