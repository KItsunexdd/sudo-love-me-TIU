#!/usr/bin/env bash
set -euo pipefail

base=${1:-http://localhost:3000}
base=${base%/}
for path in users 'devices?userId=usr_aigul' transactions 'events/poll?since=0' soc/events; do
  curl --fail --silent --show-error --max-time 30 "$base/api/$path" >/dev/null
  printf 'GET /api/%s OK\n' "$path"
done

curl --fail --silent --show-error --max-time 30 \
  --header "Origin: $base" --header 'Content-Type: application/json' --data '{"keepDevices":true}' \
  "$base/api/demo/reset"
printf '\n'
