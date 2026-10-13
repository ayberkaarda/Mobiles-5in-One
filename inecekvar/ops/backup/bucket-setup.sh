#!/usr/bin/env bash
# One-time bucket setup on MinIO (local stack and the restore drill): the backup bucket with
# versioning and its 30-day lifecycle rule, the write-only, read-only and list-only identities,
# and versioning with noncurrent-version expiry on the media and exports buckets (security
# checklist items 20 and 21, docs/ops/backup-restore.md).
#
#   1. create the backup bucket (private), enable versioning and import backup-lifecycle.json
#      (dumps expire 30 days after upload, a replaced or expired version 30 days later so an
#      overwrite is recoverable for the whole retention, incomplete uploads after 1 day;
#      Object Lock, where the store offers it, is the stronger option, see the runbook)
#   2. create the policies of minio/ (writer: PutObject under the prefix only; reader: list the
#      prefix and get; verifier: list the prefix only, for the backup.verify worker job) and
#      attach each to a new user
#   3. create the media and exports buckets when missing, enable versioning and import
#      media-lifecycle.json and exports-lifecycle.json (noncurrent photos/ and exports/ versions
#      expire after 30 days, incoming/ and quarantine/ after 1 day)
#
# It uses the MinIO admin API (`mc admin`). Cloudflare R2 has no such API: there the buckets,
# lifecycle rules and tokens are made in the dashboard, see the runbook.
#
# Usage: ops/backup/bucket-setup.sh [--help]
#
# Required environment:
#   INECEKVAR_BACKUP_S3_ENDPOINT            MinIO endpoint (rules as in backup.sh)
#   INECEKVAR_BACKUP_S3_ADMIN_ACCESS_KEY    MinIO root or admin identity
#   INECEKVAR_BACKUP_S3_ADMIN_SECRET_KEY
#   INECEKVAR_BACKUP_S3_WRITE_ACCESS_KEY    identity to create for backup.sh
#   INECEKVAR_BACKUP_S3_WRITE_SECRET_KEY
#   INECEKVAR_RESTORE_S3_READ_ACCESS_KEY    identity to create for restore.sh
#   INECEKVAR_RESTORE_S3_READ_SECRET_KEY
#   INECEKVAR_BACKUP_VERIFY_ACCESS_KEY_ID   identity to create for the backup.verify job
#   INECEKVAR_BACKUP_VERIFY_SECRET_ACCESS_KEY
# Optional:
#   INECEKVAR_BACKUP_S3_BUCKET     default inecekvar-backups
#   INECEKVAR_BACKUP_S3_PREFIX     default inecekvar/
#   INECEKVAR_MEDIA_BUCKET         default inecekvar-media (the API setting of the same name)
#   INECEKVAR_EXPORTS_BUCKET       default inecekvar-exports (the API setting of the same name)
#   INECEKVAR_BACKUP_MC_IMAGE      bucket client image (needs /bin/sh), default the minio-init
#                                  image of docker-compose.yml
#   INECEKVAR_BACKUP_DOCKER_NETWORK
#
# Secrets reach the client container through its environment only. Exit codes: 0 done, 1 a step
# failed, 2 usage or configuration error.
set -euo pipefail
set +x
umask 077

ops_name="bucket-setup"
script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=lib.sh
. "${script_dir}/lib.sh"

usage() {
  sed -n '2,/^set -euo pipefail$/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'
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

secret_keys=(INECEKVAR_BACKUP_S3_ADMIN_ACCESS_KEY INECEKVAR_BACKUP_S3_ADMIN_SECRET_KEY
  INECEKVAR_BACKUP_S3_WRITE_ACCESS_KEY INECEKVAR_BACKUP_S3_WRITE_SECRET_KEY
  INECEKVAR_RESTORE_S3_READ_ACCESS_KEY INECEKVAR_RESTORE_S3_READ_SECRET_KEY
  INECEKVAR_BACKUP_VERIFY_ACCESS_KEY_ID INECEKVAR_BACKUP_VERIFY_SECRET_ACCESS_KEY)
require_env INECEKVAR_BACKUP_S3_ENDPOINT "${secret_keys[@]}"

endpoint="${INECEKVAR_BACKUP_S3_ENDPOINT%/}"
network="${INECEKVAR_BACKUP_DOCKER_NETWORK:-}"
bucket="${INECEKVAR_BACKUP_S3_BUCKET:-${INECEKVAR_OPS_BUCKET_DEFAULT}}"
prefix="${INECEKVAR_BACKUP_S3_PREFIX-${INECEKVAR_OPS_PREFIX_DEFAULT}}"
media_bucket="${INECEKVAR_MEDIA_BUCKET:-inecekvar-media}"
exports_bucket="${INECEKVAR_EXPORTS_BUCKET:-inecekvar-exports}"
mc_image="${INECEKVAR_BACKUP_MC_IMAGE:-${INECEKVAR_OPS_MC_IMAGE_DEFAULT}}"

check_endpoint INECEKVAR_BACKUP_S3_ENDPOINT "${endpoint}" "${network}"
check_bucket "${bucket}"
check_bucket "${media_bucket}"
check_bucket "${exports_bucket}"
check_prefix "${prefix}"
[ -n "${prefix}" ] || die_config "INECEKVAR_BACKUP_S3_PREFIX must not be empty here (the policies are scoped to it)"
for name in "${secret_keys[@]}"; do
  check_url_safe "${name}" "${!name}"
done
require_tool docker

# admin_sh: runs ${admin_script} with /bin/sh inside the client image; the admin alias "a" comes
# from MC_HOST_a, the new identities from W_*, R_* and V_*. Stdin passes through (policy and
# lifecycle documents).
admin_sh() {
  local admin_url net=()
  admin_url="${endpoint%%://*}://${INECEKVAR_BACKUP_S3_ADMIN_ACCESS_KEY}:${INECEKVAR_BACKUP_S3_ADMIN_SECRET_KEY}@${endpoint#*://}"
  if [ -n "${network}" ]; then net=(--network "${network}"); fi
  env "MC_HOST_a=${admin_url}" \
    "W_ACCESS=${INECEKVAR_BACKUP_S3_WRITE_ACCESS_KEY}" "W_SECRET=${INECEKVAR_BACKUP_S3_WRITE_SECRET_KEY}" \
    "R_ACCESS=${INECEKVAR_RESTORE_S3_READ_ACCESS_KEY}" "R_SECRET=${INECEKVAR_RESTORE_S3_READ_SECRET_KEY}" \
    "V_ACCESS=${INECEKVAR_BACKUP_VERIFY_ACCESS_KEY_ID}" "V_SECRET=${INECEKVAR_BACKUP_VERIFY_SECRET_ACCESS_KEY}" \
    "BUCKET=${bucket}" "TARGET_BUCKET=${target_bucket:-}" \
    docker run --rm -i "${net[@]}" -e MC_HOST_a -e W_ACCESS -e W_SECRET -e R_ACCESS -e R_SECRET \
    -e V_ACCESS -e V_SECRET -e BUCKET -e TARGET_BUCKET \
    --entrypoint /bin/sh "${mc_image}" -c "${admin_script}"
}

template() {
  sed -e "s#@BUCKET@#${bucket}#g" -e "s#@PREFIX@#${prefix}#g" "$1"
}

echo "== step 1: backup bucket ${bucket}: versioning and the 30-day lifecycle rule"
# shellcheck disable=SC2016 # expanded by the shell inside the client container
admin_script='set -e
mc --quiet mb --ignore-existing "a/${BUCKET}"
mc --quiet anonymous set none "a/${BUCKET}"
mc --quiet version enable "a/${BUCKET}"
mc --quiet ilm import "a/${BUCKET}"
mc --quiet ilm rule ls "a/${BUCKET}"'
sed -e "s#\"Prefix\": \"inecekvar/\"#\"Prefix\": \"${prefix}\"#" "${script_dir}/backup-lifecycle.json" | admin_sh ||
  fail "backup bucket setup failed"

echo "== step 2: write-only, read-only and list-only identities"
# The client image has no text tools, so each policy document arrives on stdin in its own call.
for role in writer reader verifier; do
  admin_script="set -e
cat > /tmp/policy.json
mc --quiet admin policy create a inecekvar-backup-${role} /tmp/policy.json"
  template "${script_dir}/minio/backup-${role}-policy.json" | admin_sh || fail "policy inecekvar-backup-${role} failed"
done
# shellcheck disable=SC2016 # expanded by the shell inside the client container
admin_script='set -e
mc --quiet admin user add a "${W_ACCESS}" "${W_SECRET}" > /dev/null
mc --quiet admin user add a "${R_ACCESS}" "${R_SECRET}" > /dev/null
mc --quiet admin user add a "${V_ACCESS}" "${V_SECRET}" > /dev/null
mc --quiet admin policy attach a inecekvar-backup-writer --user "${W_ACCESS}" > /dev/null
mc --quiet admin policy attach a inecekvar-backup-reader --user "${R_ACCESS}" > /dev/null
mc --quiet admin policy attach a inecekvar-backup-verifier --user "${V_ACCESS}" > /dev/null
echo "identities: writer has inecekvar-backup-writer, reader has inecekvar-backup-reader, verifier has inecekvar-backup-verifier"'
admin_sh </dev/null || fail "identity setup failed"

echo "== step 3: versioning and noncurrent-version expiry on ${media_bucket} and ${exports_bucket}"
# shellcheck disable=SC2016 # expanded by the shell inside the client container
admin_script='set -e
mc --quiet mb --ignore-existing "a/${TARGET_BUCKET}"
mc --quiet anonymous set none "a/${TARGET_BUCKET}"
mc --quiet version enable "a/${TARGET_BUCKET}"
mc --quiet version info "a/${TARGET_BUCKET}"
mc --quiet ilm import "a/${TARGET_BUCKET}"
mc --quiet ilm rule ls "a/${TARGET_BUCKET}"'
target_bucket="${media_bucket}"
admin_sh <"${script_dir}/media-lifecycle.json" || fail "media bucket setup failed"
target_bucket="${exports_bucket}"
admin_sh <"${script_dir}/exports-lifecycle.json" || fail "exports bucket setup failed"

echo "RESULT: buckets ready"
