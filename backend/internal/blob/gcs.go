// Package blob is a thin object-storage abstraction for the demo pipeline. The
// API signs a direct-upload URL so the browser PUTs a .dem straight to the
// bucket — bypassing our servers and any proxy/body-size limit (e.g.
// Cloudflare's 100 MB cap) — and the worker pulls it back to parse, then deletes
// it. Backed by Google Cloud Storage. A nil Store means the feature is
// unconfigured and callers fall back to the through-server multipart upload.
package blob

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"time"

	"cloud.google.com/go/compute/metadata"
	"cloud.google.com/go/storage"
	iamcredentials "google.golang.org/api/iamcredentials/v1"
	"google.golang.org/api/option"
)

// Store is the object-storage surface the demo pipeline needs.
type Store interface {
	// SignPutURL returns a time-limited URL the browser can PUT the object to
	// directly. contentType, if non-empty, is bound into the signature and the
	// client must send the matching Content-Type header.
	SignPutURL(ctx context.Context, object, contentType string, ttl time.Duration) (string, error)
	// Download copies the object to destPath, refusing objects larger than
	// maxBytes (<=0 means unbounded). Returns the bytes written.
	Download(ctx context.Context, object, destPath string, maxBytes int64) (int64, error)
	// Delete removes the object; a missing object is not an error.
	Delete(ctx context.Context, object string) error
}

// GCS is a Google Cloud Storage-backed Store.
type GCS struct {
	client  *storage.Client
	bucket  string
	saEmail string                  // service-account email; set for keyless (IAM) signing
	iam     *iamcredentials.Service // set when signing via IAM SignBlob (keyless ADC)
}

// NewGCS builds a GCS store. credentialsFile may be "" to use Application
// Default Credentials (e.g. the VM's attached service account). It returns
// (nil, nil) when bucket is empty so the feature degrades gracefully — callers
// should treat a nil Store as "direct upload not configured".
//
// V4 URL signing needs a private key. With a JSON key file the client signs
// locally. With keyless ADC (a GCE/Cloud Run attached service account) there is
// no private key, so we sign via the IAM Credentials SignBlob API using the
// attached SA — which requires that SA to have roles/iam.serviceAccountTokenCreator
// on itself (plus object access on the bucket).
func NewGCS(ctx context.Context, bucket, credentialsFile string) (*GCS, error) {
	if bucket == "" {
		return nil, nil
	}
	var opts []option.ClientOption
	if credentialsFile != "" {
		opts = append(opts, option.WithCredentialsFile(credentialsFile))
	}
	client, err := storage.NewClient(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("blob: gcs client: %w", err)
	}
	g := &GCS{client: client, bucket: bucket}

	// Keyless signing path: only when no key file was supplied and we can read
	// the attached service account's email from the metadata server.
	if credentialsFile == "" && metadata.OnGCE() {
		email, err := metadata.EmailWithContext(ctx, "default")
		if err == nil && email != "" {
			iam, err := iamcredentials.NewService(ctx)
			if err != nil {
				_ = client.Close()
				return nil, fmt.Errorf("blob: iam credentials client: %w", err)
			}
			g.saEmail = email
			g.iam = iam
		}
	}
	return g, nil
}

// SignPutURL produces a V4-signed PUT URL, signing locally from a key file when
// one is configured, otherwise via the IAM SignBlob API (keyless ADC).
func (g *GCS) SignPutURL(ctx context.Context, object, contentType string, ttl time.Duration) (string, error) {
	opts := &storage.SignedURLOptions{
		Scheme:      storage.SigningSchemeV4,
		Method:      "PUT",
		Expires:     time.Now().Add(ttl),
		ContentType: contentType,
	}
	if g.iam != nil {
		opts.GoogleAccessID = g.saEmail
		opts.SignBytes = func(b []byte) ([]byte, error) {
			resp, err := g.iam.Projects.ServiceAccounts.SignBlob(
				"projects/-/serviceAccounts/"+g.saEmail,
				&iamcredentials.SignBlobRequest{Payload: base64.StdEncoding.EncodeToString(b)},
			).Context(ctx).Do()
			if err != nil {
				return nil, fmt.Errorf("iam signBlob: %w", err)
			}
			return base64.StdEncoding.DecodeString(resp.SignedBlob)
		}
	}
	url, err := g.client.Bucket(g.bucket).SignedURL(object, opts)
	if err != nil {
		return "", fmt.Errorf("blob: sign url: %w", err)
	}
	return url, nil
}

// Download streams the object to destPath. It checks the declared object size
// first (cheap) and also bounds the copy with a LimitReader so a size that lies
// can't fill the disk.
func (g *GCS) Download(ctx context.Context, object, destPath string, maxBytes int64) (int64, error) {
	obj := g.client.Bucket(g.bucket).Object(object)
	attrs, err := obj.Attrs(ctx)
	if err != nil {
		return 0, fmt.Errorf("blob: attrs: %w", err)
	}
	if maxBytes > 0 && attrs.Size > maxBytes {
		return 0, fmt.Errorf("blob: object is %d bytes, over the %d limit", attrs.Size, maxBytes)
	}

	r, err := obj.NewReader(ctx)
	if err != nil {
		return 0, fmt.Errorf("blob: open reader: %w", err)
	}
	defer r.Close()

	f, err := os.Create(destPath)
	if err != nil {
		return 0, fmt.Errorf("blob: create dest: %w", err)
	}
	defer f.Close()

	limit := maxBytes
	if limit <= 0 {
		limit = 1 << 62
	}
	n, err := io.Copy(f, io.LimitReader(r, limit+1))
	if err != nil {
		return n, fmt.Errorf("blob: copy: %w", err)
	}
	if maxBytes > 0 && n > maxBytes {
		return n, fmt.Errorf("blob: object exceeds the %d limit", maxBytes)
	}
	return n, nil
}

// Delete removes the object. A missing object is treated as success.
func (g *GCS) Delete(ctx context.Context, object string) error {
	err := g.client.Bucket(g.bucket).Object(object).Delete(ctx)
	if err != nil && err != storage.ErrObjectNotExist {
		return fmt.Errorf("blob: delete: %w", err)
	}
	return nil
}

// Close releases the underlying client.
func (g *GCS) Close() error { return g.client.Close() }
