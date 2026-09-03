#!/usr/bin/env bash
set -euo pipefail

container_name="channelsmith-qdrant"
image="qdrant/qdrant:v1.19.0"
storage_dir="${HOME}/qdrant/channelsmith"
qdrant_url="${QDRANT_URL:-http://localhost:6333}"

mkdir -p "$storage_dir"

if docker container inspect "$container_name" >/dev/null 2>&1; then
  current_image="$(docker inspect -f '{{.Config.Image}}' "$container_name")"
  if [ "$current_image" != "$image" ]; then
    docker stop "$container_name" >/dev/null 2>&1 || true
    docker rm "$container_name" >/dev/null
    docker run -d \
      --name "$container_name" \
      --restart unless-stopped \
      -p 6333:6333 \
      -v "$storage_dir:/qdrant/storage" \
      "$image" >/dev/null
  elif [ "$(docker inspect -f '{{.State.Running}}' "$container_name")" != "true" ]; then
    docker start "$container_name" >/dev/null
  fi
else
  docker run -d \
    --name "$container_name" \
    --restart unless-stopped \
    -p 6333:6333 \
    -v "$storage_dir:/qdrant/storage" \
    "$image" >/dev/null
fi

headers=(-H 'Content-Type: application/json')
if [ -n "${QDRANT_API_KEY:-}" ]; then
  headers+=(-H "api-key: ${QDRANT_API_KEY}")
fi

for attempt in {1..30}; do
  if curl --fail --silent --show-error "${headers[@]}" "$qdrant_url/readyz" >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    echo "Qdrant did not become ready at $qdrant_url" >&2
    exit 1
  fi
  sleep 1
done

ensure_collection() {
  local name="$1"
  if curl --fail --silent --show-error "${headers[@]}" "$qdrant_url/collections/$name" >/dev/null 2>&1; then
    return
  fi
  curl --fail --silent --show-error -X PUT "${headers[@]}" \
    "$qdrant_url/collections/$name?wait=true" \
    --data '{"vectors":{"size":512,"distance":"Cosine"},"on_disk_payload":true}' >/dev/null
}

ensure_payload_index() {
  local collection="$1"
  local field="$2"
  local schema="$3"
  curl --fail --silent --show-error -X PUT "${headers[@]}" \
    "$qdrant_url/collections/$collection/index?wait=true" \
    --data "{\"field_name\":\"$field\",\"field_schema\":\"$schema\"}" >/dev/null
}

ensure_collection videos_v1
ensure_collection channels_v1

if ! curl --fail --silent --show-error "${headers[@]}" "$qdrant_url/collections/videos_v2" >/dev/null 2>&1; then
  curl --fail --silent --show-error -X PUT "${headers[@]}" \
    "$qdrant_url/collections/videos_v2?wait=true" \
    --data '{
      "vectors": {
        "title": {"size":512,"distance":"Cosine"},
        "purpose": {"size":512,"distance":"Cosine"},
        "mechanism": {"size":512,"distance":"Cosine","hnsw_config":{"m":0}},
        "niche": {"size":512,"distance":"Cosine","hnsw_config":{"m":0}},
        "detopic": {"size":512,"distance":"Cosine","hnsw_config":{"m":0}}
      },
      "on_disk_payload": true
    }' >/dev/null
fi

ensure_payload_index videos_v1 channel_id keyword
ensure_payload_index videos_v1 published_at integer
ensure_payload_index videos_v1 topic_niche keyword
ensure_payload_index videos_v1 is_outlier bool
ensure_payload_index videos_v1 score float
ensure_payload_index videos_v2 video_id keyword
ensure_payload_index videos_v2 channel_id keyword
ensure_payload_index videos_v2 published_at integer
ensure_payload_index videos_v2 is_outlier bool
ensure_payload_index videos_v2 score float
ensure_payload_index videos_v2 facet_model keyword
ensure_payload_index channels_v1 subscriber_count integer
ensure_payload_index channels_v1 top_niches keyword
ensure_payload_index channels_v1 lane keyword

image_digest="$(docker image inspect "$image" --format '{{index .RepoDigests 0}}' 2>/dev/null || true)"
echo "Qdrant is ready with videos_v1, videos_v2 and channels_v1 at $qdrant_url (${image_digest:-$image})"
