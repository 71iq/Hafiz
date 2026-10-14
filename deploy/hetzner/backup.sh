#!/bin/bash
set -euo pipefail
umask 077
exec 9<>/run/hafiz/operation.lock
flock 9
root=/var/backups/hafiz
stamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$root"
folder="$root/$stamp.partial"
mkdir "$folder"
writers=(hafiz-auth hafiz-rest hafiz-storage hafiz-functions)
restart_writers() {
  backup_status=$?
  docker start "${writers[@]}" >/dev/null || backup_status=1
  ready=0
  for attempt in {1..30}; do
    if /usr/local/sbin/hafiz-health; then ready=1; break; fi
    sleep 2
  done
  [[ "$ready" == 1 ]] || backup_status=1
  exit "$backup_status"
}
/usr/local/sbin/hafiz-health
trap restart_writers EXIT
docker stop --time 30 "${writers[@]}" >/dev/null
docker exec hafiz-db pg_dump -U supabase_admin -d postgres --format=custom > "$folder/database.dump"
tar -C /opt/hafiz/supabase -czf "$folder/storage.tar.gz" volumes/storage
tar -czf "$folder/configuration.tar.gz" \
  /etc/hafiz /etc/caddy/hafiz.caddy /etc/systemd/system/hafiz*.service \
  /etc/systemd/system/hafiz*.timer /etc/tmpfiles.d/hafiz.conf \
  /usr/local/sbin/hafiz-* /usr/local/bin/hafiz-receive \
  /etc/sudoers.d/hafiz-deploy /var/lib/hafizdeploy/.ssh/authorized_keys
readlink /opt/hafiz/current > "$folder/release.txt"
(cd "$folder" && sha256sum database.dump storage.tar.gz configuration.tar.gz release.txt > SHA256SUMS)
mv "$folder" "$root/$stamp"
# Complete dated backups only. Partial backups require operator review.
find "$root" -mindepth 1 -maxdepth 1 -type d -mtime +7 \
  -regextype posix-extended -regex '.*/[0-9]{8}T[0-9]{6}Z' -exec rm -r -- {} +
echo "Backup complete: $root/$stamp"
