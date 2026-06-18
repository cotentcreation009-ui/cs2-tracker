# testdata

Drop CS2 GOTV demo files (`.dem`) here to try the parser.

The `worker` container mounts this directory read-only at `/demos`, so you can
ingest a demo through the API:

```bash
curl -X POST localhost:8080/api/ingest/demo \
  -H 'content-type: application/json' \
  -d '{"demoPath":"/demos/your-match.dem","source":"local"}'
```

Or parse one directly without any services running:

```bash
cd backend
go run ./cmd/parsedemo testdata/your-match.dem
```

`.dem` files are git-ignored — they are large and not meant to be committed.
