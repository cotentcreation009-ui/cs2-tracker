// Route selection for the Leetify relay Worker. Run from the repo root with:
//   node --test deploy/leetify-relay.worker.test.mjs
// (Node 22.7+ reads the Worker's ES-module syntax without a package.json).
// The Worker's fetch handler itself runs only on Cloudflare, so what is
// tested is the one decision that matters for a paste: which path goes to
// which Leetify host, with what query, and which is refused — plus the
// handler's own refusals, which never reach Leetify.

import { test } from "node:test";
import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";

// Cloudflare's WebCrypto has timingSafeEqual on crypto.subtle; Node's does
// not. The Worker file stays Cloudflare-native; the test lends Node's.
if (!crypto.subtle.timingSafeEqual) {
  crypto.subtle.timingSafeEqual = (a, b) => timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const worker = (await import("./leetify-relay.worker.js")).default;
const { route, upstreamURL } = await import("./leetify-relay.worker.js");

const APP = "https://api.cs-prod.leetify.com";
const PUBLIC = "https://api-public.cs-prod.leetify.com";
const ID = "76561198200413817";
const CODE = "CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE";

test("the app routes go to the app host", () => {
  for (const p of [
    `/api/profile/${ID}/meta`,
    `/api/profile/${ID}/match-history`,
    `/api/profile/${ID}/recent-games/available-data-sources`,
    `/api/profile/${ID}/recent-games/5v5`,
    `/api/profile/${ID}/recent-games/matchmaking_competitive`,
    // one game's scoreboard: a UUID id on current games, hex-and-dash on old
    "/api/games/dc6e67a8-51fc-425e-9938-5bf71e47b254",
    "/api/games/0f8e4cbd285ff241-1a539d",
  ]) {
    assert.deepEqual(route(p), { upstream: APP, kind: "app" }, p);
    assert.equal(upstreamURL(route(p), p, new URLSearchParams("steam64_id=1")), APP + p, p);
  }
});

test("every public route the backend calls goes to api-public", () => {
  for (const p of [
    "/v3/profile",
    "/v3/profile/matches",
    `/v2/matches/matchmaking/${CODE}`,
    "/v2/matches/0d1b2f3e-4a5c-6d7e-8f90-a1b2c3d4e5f6",
  ]) {
    assert.deepEqual(route(p), { upstream: PUBLIC, kind: "public" }, p);
  }
});

test("the profile routes forward only a 17-digit steam64_id and refuse without one", () => {
  const q = new URLSearchParams(`steam64_id=${ID}&limit=500&offset=0`);
  for (const p of ["/v3/profile", "/v3/profile/matches"]) {
    assert.equal(upstreamURL(route(p), p, q), `${PUBLIC}${p}?steam64_id=${ID}`, p);
    assert.equal(upstreamURL(route(p), p, new URLSearchParams("")), null, `${p} without an id`);
    assert.equal(upstreamURL(route(p), p, new URLSearchParams("steam64_id=abc")), null, `${p} with a bad id`);
  }
  // The match routes take no query, and none is forwarded.
  const m = `/v2/matches/matchmaking/${CODE}`;
  assert.equal(upstreamURL(route(m), m, q), PUBLIC + m);
});

test("anything else is not relayed", () => {
  for (const p of [
    "/",
    "/v3",
    "/v3/profile/extra",
    "/v2/matches/",
    "/v2/matches/matchmaking/CSGO-short",
    "/v2/matches/../profile",
    `/api/profile/${ID}`,
    `/api/profile/${ID}/recent-games/`,
    "/api/profile/123/meta",
    "/api/games",
    "/api/games/",
    "/api/games/dc6e67a8-51fc-425e-9938-5bf71e47b254/extra",
    "/api/games/dc6e67a8.51fc",
    "/api/games/../profile",
    `/api/games/${"a".repeat(65)}`,
    "/v1/profile",
  ]) {
    assert.equal(route(p), null, p);
  }
});

test("the Worker refuses without the key, 404s an unknown route and 400s a profile without an id", async () => {
  const env = { RELAY_KEY: "s3cret" };
  const call = (path, headers = {}) =>
    worker.fetch(new Request("https://relay.example" + path, { headers }), env);
  assert.equal((await call("/healthz")).status, 200);
  assert.equal((await call("/v3/profile?steam64_id=" + ID)).status, 401);
  assert.equal((await call("/nope", { "x-relay-key": "s3cret" })).status, 404);
  assert.equal((await call("/v3/profile", { "x-relay-key": "s3cret" })).status, 400);
  assert.equal(
    (await worker.fetch(new Request("https://relay.example/v3/profile", { method: "POST" }), env)).status,
    405,
  );
});
