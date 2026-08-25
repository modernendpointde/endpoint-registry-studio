#!/bin/sh
set -eu

image="${1:?Usage: smoke-test.sh IMAGE}"
container="endpoint-registry-studio-smoke-$$"
headers_dir="$(mktemp -d)"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$headers_dir"
}
trap cleanup EXIT INT TERM

docker run -d \
  --name "$container" \
  --read-only \
  --tmpfs /tmp:size=16m,mode=1777 \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  -p 127.0.0.1::8080 \
  "$image" >/dev/null

port="$(docker port "$container" 8080/tcp | sed 's/.*://')"
base_url="http://127.0.0.1:$port"

attempt=0
until curl -fsS "$base_url/" >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    docker logs "$container"
    exit 1
  fi
  sleep 1
done

assert_headers() {
  path="$1"
  cache_control="$2"
  output="$headers_dir/$(printf '%s' "$path" | tr '/.' '__').headers"
  curl -fsS -D "$output" -o /dev/null "$base_url$path"
  grep -Fqi 'Content-Security-Policy:' "$output"
  grep -Fqi 'X-Content-Type-Options: nosniff' "$output"
  grep -Fqi 'Referrer-Policy: no-referrer' "$output"
  grep -Fqi 'Permissions-Policy:' "$output"
  grep -Fqi 'Cross-Origin-Opener-Policy: same-origin' "$output"
  grep -Fqi "Cache-Control: $cache_control" "$output"
}

asset="$(curl -fsS "$base_url/index.html" | grep -oE 'assets/[^" ]+\.(js|css)' | head -n 1)"
test -n "$asset"

assert_headers / 'no-cache'
assert_headers /index.html 'no-cache'
assert_headers /config.json 'no-store'
assert_headers /LICENSE 'no-cache'
assert_headers /THIRD_PARTY_NOTICES.md 'no-cache'
assert_headers "/$asset" 'public, max-age=31536000, immutable'

curl -fsS "$base_url/LICENSE" | grep -Fq 'Copyright (c) 2026 Endpoint Registry Studio contributors'
curl -fsS "$base_url/THIRD_PARTY_NOTICES.md" | grep -Fq 'Copyright (c) Meta Platforms, Inc. and affiliates.'
curl -fsS "$base_url/THIRD_PARTY_NOTICES.md" | grep -Fq 'Permission is hereby granted, free of charge'

attempt=0
while [ "$(docker inspect "$container" --format '{{.State.Health.Status}}')" != "healthy" ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 45 ]; then
    docker inspect "$container" --format '{{json .State.Health}}'
    docker logs "$container"
    exit 1
  fi
  sleep 1
done
