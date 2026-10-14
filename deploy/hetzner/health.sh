#!/bin/bash
set -euo pipefail
curl --fail --silent --max-time 10 http://127.0.0.1:8081/__release.json >/dev/null
docker exec hafiz-auth wget -q -O /dev/null http://127.0.0.1:9999/health
docker exec hafiz-db pg_isready -U postgres -h localhost >/dev/null
for service in hafiz-db hafiz-auth hafiz-gateway hafiz-rest hafiz-storage hafiz-imgproxy hafiz-functions; do
  [[ $(docker inspect --format '{{.State.Health.Status}}' "$service") == healthy ]]
done
