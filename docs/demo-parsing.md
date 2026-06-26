# Demo parsing — direct upload to Google Cloud Storage

CS2 demos run 100–400 MB. A normal upload (browser → Cloudflare → our server)
hits Cloudflare's **100 MB** request-body cap on the free plan, so big demos
fail. The fix is the same one the original app used with S3: the browser uploads
the `.dem` **directly to object storage** via a presigned URL, bypassing every
proxy size limit. The worker then pulls it from the bucket, parses it, stores the
compact replay JSON, and deletes the object.

```
browser → /api/demos/presign  → backend returns a signed GCS PUT URL + id
browser → PUT .dem → storage.googleapis.com   (no proxy in the path; no size cap)
browser → /api/demos/parse {id} → backend enqueues a parse job (idempotent)
worker  → download from GCS → parse → store JSON → delete object
```

If `DEMO_GCS_BUCKET` is unset the feature degrades to through-server multipart
upload, capped at 95 MB.

## One-time GCP setup

Replace `BUCKET` and `SA_EMAIL` below. Run from a machine with `gcloud` auth.

### 1. Create the bucket (uniform access, not public)

```bash
gcloud storage buckets create gs://BUCKET \
  --location=us-central1 \
  --uniform-bucket-level-access \
  --public-access-prevention
```

### 2. CORS — so the browser PUT isn't blocked

Without this the direct PUT fails with an opaque CORS error.

```bash
gcloud storage buckets update gs://BUCKET --cors-file=deploy/gcs/cors.json
```

(Edit `deploy/gcs/cors.json` if the site origin isn't `https://steamcommunity.run`.)

### 3. Lifecycle — auto-delete orphaned uploads

Objects that get uploaded but never parsed (closed tab, etc.) are removed after
1 day; the worker deletes parsed objects immediately, so this is just cleanup.

```bash
gcloud storage buckets update gs://BUCKET --lifecycle-file=deploy/gcs/lifecycle.json
```

### 4. Service-account permissions

The backend/worker run with the VM's **attached service account** (keyless,
Application Default Credentials). Grant it:

```bash
# Read/write/delete objects in the bucket
gcloud storage buckets add-iam-policy-binding gs://BUCKET \
  --member="serviceAccount:SA_EMAIL" --role="roles/storage.objectAdmin"

# Sign upload URLs without a key file (IAM SignBlob) — the SA signs as itself
gcloud iam service-accounts add-iam-policy-binding SA_EMAIL \
  --member="serviceAccount:SA_EMAIL" --role="roles/iam.serviceAccountTokenCreator"
```

> Prefer a JSON key file instead of keyless signing? Create a key, mount it into
> the `backend` and `worker` containers, and set `DEMO_GCS_CREDENTIALS` to its
> path. Keyless (the default above) avoids managing a secret and is recommended
> on GCE.

### 5. Enable it

In `.env`:

```
DEMO_GCS_BUCKET=BUCKET
# DEMO_GCS_CREDENTIALS=         # leave blank for keyless ADC
DEMO_MAX_MB=600
DEMO_URL_TTL=15m
```

Then redeploy. On startup the API logs either `demo direct-upload enabled` or a
clear error if URL signing isn't permitted (fix the Token Creator role above).

## Capacity note

Parsing a large demo needs RAM (~1–2.5 GB). The `worker` service is capped at
2 GB (`mem_limit`) and runs one parse at a time. On the 4 GB VM that's tight for
300 MB+ demos; resize to **e2-standard-2 (8 GB)** for comfortable big-demo
parsing:

```bash
gcloud compute instances stop cs2 --zone=us-central1-a
gcloud compute instances set-machine-type cs2 --machine-type=e2-standard-2 --zone=us-central1-a
gcloud compute instances start cs2 --zone=us-central1-a
```

To run more than one parse at once, raise `WORKER_CONCURRENCY` (needs ~2 GB ×
concurrency of headroom) or run additional `worker` replicas.
