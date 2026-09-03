# Move the semantic Qdrant collections to Hetzner

This runbook moves `videos_v1` and `channels_v1` as collection snapshots. Source and destination
must run the same tested Qdrant release (`qdrant/qdrant:v1.19.0`). Snapshot recovery overwrites a
same-named destination collection, so verify the target and retain its current snapshot first.

## 1. Verify and snapshot locally

```bash
curl -fsS "$QDRANT_URL/" | jq '{version,commit}'
curl -fsS "$QDRANT_URL/collections/videos_v1" | jq '.result.points_count'
curl -fsS "$QDRANT_URL/collections/channels_v1" | jq '.result.points_count'

VIDEO_SNAPSHOT=$(curl -fsS -X POST "$QDRANT_URL/collections/videos_v1/snapshots?wait=true" | jq -r '.result.name')
CHANNEL_SNAPSHOT=$(curl -fsS -X POST "$QDRANT_URL/collections/channels_v1/snapshots?wait=true" | jq -r '.result.name')

curl -fsS "$QDRANT_URL/collections/videos_v1/snapshots/$VIDEO_SNAPSHOT" -o "$VIDEO_SNAPSHOT"
curl -fsS "$QDRANT_URL/collections/channels_v1/snapshots/$CHANNEL_SNAPSHOT" -o "$CHANNEL_SNAPSHOT"
shasum -a 256 "$VIDEO_SNAPSHOT" "$CHANNEL_SNAPSHOT"
```

Add `-H "api-key: $QDRANT_API_KEY"` to each request when the source uses an API key. Do not place
the key in the URL, shell history, snapshot filename, or repository.

## 2. Copy to Hetzner

```bash
scp "$VIDEO_SNAPSHOT" "$CHANNEL_SNAPSHOT" channelsmith@HETZNER_HOST:/srv/qdrant/import/
```

Record the two SHA-256 values and verify them again on the host before recovery.

## 3. Restore on Hetzner

Run from the Hetzner host so the files stay local to the upload:

```bash
curl -fsS -X POST "http://127.0.0.1:6333/collections/videos_v1/snapshots/upload?wait=true&priority=snapshot" \
  -H "api-key: $QDRANT_API_KEY" \
  -F "snapshot=@/srv/qdrant/import/$VIDEO_SNAPSHOT"

curl -fsS -X POST "http://127.0.0.1:6333/collections/channels_v1/snapshots/upload?wait=true&priority=snapshot" \
  -H "api-key: $QDRANT_API_KEY" \
  -F "snapshot=@/srv/qdrant/import/$CHANNEL_SNAPSHOT"
```

## 4. Verify before cutover

```bash
curl -fsS -H "api-key: $QDRANT_API_KEY" http://127.0.0.1:6333/collections/videos_v1 \
  | jq '{points:.result.points_count,vectors:.result.config.params.vectors,payload:.result.payload_schema}'
curl -fsS -H "api-key: $QDRANT_API_KEY" http://127.0.0.1:6333/collections/channels_v1 \
  | jq '{points:.result.points_count,vectors:.result.config.params.vectors,payload:.result.payload_schema}'
```

Require 512-d cosine vectors, all expected payload indexes, and counts within 2% of the bounded SQL
counts. Exercise the two similar routes and semantic `/search` against the Hetzner URL before
changing application configuration.

## Rollback

Restore the pre-move Hetzner snapshots with the same upload commands, or point `QDRANT_URL` back to
the local node. The app remains usable during rollback: semantic-only endpoints return 503 and
hybrid search reports a degraded lexical fallback.
