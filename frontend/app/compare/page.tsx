import type { Metadata } from "next";
import { ApiError, getLeetify, getProfile, resolveSteamId } from "@/lib/api";
import { ComparisonView } from "@/components/ComparisonView";
import { CompareForm } from "@/components/CompareForm";
import { FetchError } from "@/components/FetchError";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Compare players — CS2 Tracker" };

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { a, b } = await searchParams;

  if (!a || !b) {
    return (
      <div className="mx-auto max-w-xl">
        <h1 className="text-2xl font-bold">Compare players</h1>
        <p className="mt-1 text-sm text-muted">
          Enter two players (SteamID64 or vanity) to see their careers side by
          side.
        </p>
        <div className="mt-5">
          <CompareForm initialA={a} initialB={b} />
        </div>
      </div>
    );
  }

  try {
    const [idA, idB] = await Promise.all([resolveSteamId(a), resolveSteamId(b)]);
    const [pa, pb, la, lb] = await Promise.all([
      getProfile(idA),
      getProfile(idB),
      getLeetify(idA),
      getLeetify(idB),
    ]);
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Head to head</h1>
        <ComparisonView a={pa} b={pb} leetifyA={la} leetifyB={lb} />
        <CompareForm initialA={a} initialB={b} />
      </div>
    );
  } catch (e) {
    if (e instanceof ApiError) {
      return <FetchError status={e.status} message={e.message} />;
    }
    throw e;
  }
}
