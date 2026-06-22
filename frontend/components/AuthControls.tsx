import Link from "next/link";
import { getSession } from "@/lib/session";

// Header auth widget. Signed out → a "Sign in through Steam" link. Signed in →
// the player's avatar + persona (linking to their own profile) and a sign-out
// button. Async Server Component: it reads the session cookie directly.
export async function AuthControls() {
  const user = await getSession();

  if (!user) {
    return (
      <a
        href="/api/auth/steam/login"
        className="shrink-0 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-sm font-medium text-ink transition hover:border-brand/60"
      >
        Sign in through Steam
      </a>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Link
        href={`/profiles/${user.steamId64}`}
        className="flex items-center gap-2 rounded-lg border border-line bg-panel2 px-2 py-1 text-sm font-medium text-ink transition hover:border-brand/60"
        title="Your profile"
      >
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl}
            alt=""
            className="h-6 w-6 rounded object-cover"
          />
        ) : (
          <span className="grid h-6 w-6 place-items-center rounded bg-panel text-xs font-bold text-faint">
            {(user.personaName || "?").slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="max-w-[10rem] truncate">
          {user.personaName || user.steamId64}
        </span>
      </Link>
      <form action="/api/auth/logout" method="post">
        <button
          type="submit"
          className="link-muted text-sm font-medium"
          title="Sign out"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
