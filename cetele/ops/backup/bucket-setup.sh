#!/bin/sh
# One-time bucket setup on MinIO (local stack and the restore drill): the backup bucket with its
# 30-day lifecycle rule, the write-only and the read-only identities, and versioning on the media
# bucket (security checklist item 20, docs/ops/backup-restore.md).
#
#   1. create the backup bucket (private) and import backup-lifecycle.json (dumps expire after
#      30 days, incomplete uploads after 1 day)
#   2. create the policies of minio/ (writer: PutObject under the prefix only; reader: list the
#      prefix and get) and attach them to two new users
#   3. create the media bucket when missing, enable versioning on it and import
#      media-lifecycle.json (noncurrent media/ versions expire after 30 days, uploads/ after 1 day)
#
# It uses the MinIO admin API (`mc admin`). Cloudflare R2 has no such API: there the bucket,
# lifecycle rule and tokens are made in the dashboard, see the runbook.
#
# Usage: ops/backup/bucket-setup.sh [--help]
#
# Required environment:
#   CETELE_BACKUP_S3_ENDPOINT           MinIO endpoint (rules as in backup.sh)
#   CETELE_BACKUP_S3_ADMIN_ACCESS_KEY   MinIO root or admin identity
#   CETELE_BACKUP_S3_ADMIN_SECRET_KEY
#   CETELE_BACKUP_S3_WRITE_ACCESS_KEY   identity to create for backup.sh
#   CETELE_BACKUP_S3_WRITE_SECRET_KEY
#   CETELE_RESTORE_S3_READ_ACCESS_KEY   identity to create for restore.sh
#   CETELE_RESTORE_S3_READ_SECRET_KEY
# Optional:
#   CETELE_BACKUP_S3_BUCKET     default cetele-backups
#   CETELE_BACKUP_S3_PREFIX     default cetele/
#   CETELE_S3_BUCKET_MEDIA      default cetele-media
#   CETELE_BACKUP_MC_IMAGE      bucket client image (needs /bin/sh), default the minio-init
#                               image of docker-compose.yml
#   CETELE_BACKUP_DOCKER_NETWORK
#
# Secrets reach the client container through its environment only. Exit codes: 0 done, 1 a step
# failed, 2 usage or configuration error.
set -eu
set +x
umask 077

ops_name="bucket-setup"
script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=lib.sh
. "${script_dir}/lib.sh"

usage() {
  sed -n '2,/^set -eu$/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    *) die_config "unknown argument: $1 (see --help)" ;;
  esac
done

require_env CETELE_BACKUP_S3_ENDPOINT CETELE_BACKUP_S3_ADMIN_ACCESS_KEY CETELE_BACKUP_S3_ADMIN_SECRET_KEY \
  CETELE_BACKUP_S3_WRITE_ACCESS_KEY CETELE_BACKUP_S3_WRITE_SECRET_KEY \
  CETELE_RESTORE_S3_READ_ACCESS_KEY CETELE_RESTORE_S3_READ_SECRET_KEY

endpoint="${CETELE_BACKUP_S3_ENDPOINT%/}"
network="${CETELE_BACKUP_DOCKER_NETWORK:-}"
bucket="${CETELE_BACKUP_S3_BUCKET:-cetele-backups}"
prefix="${CETELE_BACKUP_S3_PREFIX-cetele/}"
media_bucket="${CETELE_S3_BUCKET_MEDIA:-cetele-media}"
mc_image="${CETELE_BACKUP_MC_IMAGE:-${CETELE_OPS_MC_IMAGE_DEFAULT}}"

check_endpoint CETELE_BACKUP_S3_ENDPOINT "${endpoint}" "${network}"
check_bucket "${bucket}"
check_bucket "${media_bucket}"
check_prefix "${prefix}"
[ -n "${prefix}" ] || die_config "CETELE_BACKUP_S3_PREFIX must not be empty here (the policies are scoped to it)"
for name in CETELE_BACKUP_S3_ADMIN_ACCESS_KEY CETELE_BACKUP_S3_ADMIN_SECRET_KEY CETELE_BACKUP_S3_WRITE_ACCESS_KEY \
  CETELE_BACKUP_S3_WRITE_SECRET_KEY CETELE_RESTORE_S3_READ_ACCESS_KEY CETELE_RESTORE_S3_READ_SECRET_KEY; do
  eval "check_url_safe ${name} \"\${${name}}\""
done
require_tool docker

# admin_sh SCRIPT: runs SCRIPT with /bin/sh inside the client image; the admin alias "a" comes
# from MC_HOST_a, the two new identities from W_ACCESS, W_SECRET, R_ACCESS and R_SECRET.
# Stdin passes through (the policy and lifecycle documents).
admin_sh() {
  admin_url="${endpoint%%://*}://${CETELE_BACKUP_S3_ADMIN_ACCESS_KEY}:${CETELE_BACKUP_S3_ADMIN_SECRET_KEY}@${endpoint#*://}"
  if [ -n "${network}" ]; then set -- --network "${network}" "$@"; fi
  env "MC_HOST_a=${admin_url}" \
    "W_ACCESS=${CETELE_BACKUP_S3_WRITE_ACCESS_KEY}" "W_SECRET=${CETELE_BACKUP_S3_WRITE_SECRET_KEY}" \
    "R_ACCESS=${CETELE_RESTORE_S3_READ_ACCESS_KEY}" "R_SECRET=${CETELE_RESTORE_S3_READ_SECRET_KEY}" \
    "BUCKET=${bucket}" "MEDIA_BUCKET=${media_bucket}" \
    docker run --rm -i "$@" -e MC_HOST_a -e W_ACCESS -e W_SECRET -e R_ACCESS -e R_SECRET -e BUCKET -e MEDIA_BUCKET \
    --entrypoint /bin/sh "${mc_image}" -c "${admin_script}"
}

template() {
  sed -e "s#@BUCKET@#${bucket}#g" -e "s#@PREFIX@#${prefix}#g" "$1"
}

echo "== step 1: backup bucket ${bucket} with the 30-day lifecycle rule"
# shellcheck disable=SC2016 # expanded by the shell inside the client container
admin_script='set -e
mc --quiet mb --ignore-existing "a/${BUCKET}"
mc --quiet anonymous set none "a/${BUCKET}"
mc --quiet ilm import "a/${BUCKET}"
mc --quiet ilm rule ls "a/${BUCKET}"'
sed -e "s#\"Prefix\": \"cetele/\"#\"Prefix\": \"${prefix}\"#" "${script_dir}/backup-lifecycle.json" | admin_sh ||
  fail "backup bucket setup failed"

echo "== step 2: write-only and read-only identities"
# The client image has no text tools, so each policy document arrives on stdin in its own call.
for role in writer reader; do
  admin_script="set -e
cat > /tmp/policy.json
mc --quiet admin policy create a cetele-backup-${role} /tmp/policy.json"
  template "${script_dir}/minio/backup-${role}-policy.json" | admin_sh || fail "policy cetele-backup-${role} failed"
done
# shellcheck disable=SC2016 # expanded by the shell inside the client container
admin_script='set -e
mc --quiet admin user add a "${W_ACCESS}" "${W_SECRET}" > /dev/null
mc --quiet admin user add a "${R_ACCESS}" "${R_SECRET}" > /dev/null
mc --quiet admin policy attach a cetele-backup-writer --user "${W_ACCESS}" > /dev/null
mc --quiet admin policy attach a cetele-backup-reader --user "${R_ACCESS}" > /dev/null
echo "identities: writer has cetele-backup-writer, reader has cetele-backup-reader"'
admin_sh </dev/null || fail "identity setup failed"

echo "== step 3: versioning on the media bucket ${media_bucket}"
# shellcheck disable=SC2016 # expanded by the shell inside the client container
admin_script='set -e
mc --quiet mb --ignore-existing "a/${MEDIA_BUCKET}"
mc --quiet anonymous set none "a/${MEDIA_BUCKET}"
mc --quiet version enable "a/${MEDIA_BUCKET}"
mc --quiet version info "a/${MEDIA_BUCKET}"
mc --quiet ilm import "a/${MEDIA_BUCKET}"
mc --quiet ilm rule ls "a/${MEDIA_BUCKET}"'
admin_sh <"${script_dir}/media-lifecycle.json" || fail "media bucket setup failed"

echo "RESULT: buckets ready"
