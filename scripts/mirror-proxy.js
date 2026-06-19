// Local helper for the steamcommunity-TLD mirror demo.
//
// The app already mirrors Steam's URL paths (/id/<vanity>, /profiles/<id>), so
// pointing a steamcommunity.<tld> host at it reproduces the "swap .com for .rip"
// trick. Browsers drop the port when you edit a URL's TLD, so to feel it locally
// you need the app on port 80. This zero-dependency proxy forwards :80 -> :3000.
//
//   1) Map a host to localhost (one-time, ADMIN), e.g. add to
//      C:\Windows\System32\drivers\etc\hosts :   127.0.0.1 steamcommunity.test
//   2) node scripts/mirror-proxy.js        (ADMIN if your OS reserves port 80)
//   3) open http://steamcommunity.test/id/<vanity>
//
// Use a reserved/owned TLD like .test for local demos — do NOT map a real site
// you use (e.g. steamcommunity.rip) or you'll shadow it in your browser.
const http = require("http");

const TARGET = { host: "127.0.0.1", port: Number(process.env.TARGET_PORT) || 3000 };
const LISTEN = Number(process.env.LISTEN_PORT) || 80;

http
  .createServer((req, res) => {
    const upstream = http.request(
      {
        host: TARGET.host,
        port: TARGET.port,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (pr) => {
        res.writeHead(pr.statusCode || 502, pr.headers);
        pr.pipe(res);
      },
    );
    upstream.on("error", (e) => {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end("proxy error: " + e.message);
    });
    req.pipe(upstream);
  })
  .listen(LISTEN, () =>
    console.log(`mirror proxy on :${LISTEN} -> ${TARGET.host}:${TARGET.port}`),
  );
