#!/usr/bin/env bash
# /usr/local/bin/dsh-provision.sh
# Deterministic OS account provisioning for CopyMonster tenant isolation
# Usage: /usr/local/bin/dsh-provision.sh <username> <uid>
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <username> <uid>" >&2
  exit 1
fi

USERNAME="$1"
UID_NUM="$2"

# 1. Validate username format (lowercase alphanumeric, underscores, hyphens, 3-32 chars)
if ! [[ "${USERNAME}" =~ ^[a-z0-9_-]{3,32}$ ]]; then
  echo "Error: Invalid username format '${USERNAME}' (allowed: ^[a-z0-9_-]{3,32}$)" >&2
  exit 2
fi

# 2. Validate UID range (100000 - 300000)
if ! [[ "${UID_NUM}" =~ ^[0-9]+$ ]] || [[ "${UID_NUM}" -lt 100000 ]] || [[ "${UID_NUM}" -gt 300000 ]]; then
  echo "Error: Invalid UID '${UID_NUM}' (must be integer between 100000 and 300000)" >&2
  exit 3
fi

# 3. Ensure primary isolation group exists
if ! getent group dshusers >/dev/null 2>&1; then
  if command -v groupadd >/dev/null 2>&1; then
    groupadd -g 100000 dshusers 2>/dev/null || groupadd dshusers 2>/dev/null || true
  elif command -v addgroup >/dev/null 2>&1; then
    addgroup -g 100000 dshusers 2>/dev/null || true
  fi
fi

# 4. Create Linux system user without interactive password, assigned to dshusers
if ! id -u "${USERNAME}" >/dev/null 2>&1; then
  if command -v useradd >/dev/null 2>&1; then
    useradd -M -u "${UID_NUM}" -g dshusers -s /bin/bash -c "CopyMonster Sandbox ${USERNAME}" "${USERNAME}" 2>/dev/null || true
  elif command -v adduser >/dev/null 2>&1; then
    adduser -D -u "${UID_NUM}" -G dshusers -s /bin/bash "${USERNAME}" 2>/dev/null || true
  fi
fi

# 5. Provision isolated home hierarchy with chmod 700
USER_HOME="/home/${USERNAME}"
mkdir -p "${USER_HOME}/workspace"
mkdir -p "${USER_HOME}/.dsh"

# Set ownership and lock permissions strictly to tenant
if id -u "${USERNAME}" >/dev/null 2>&1; then
  chown -R "${USERNAME}:dshusers" "${USER_HOME}"
else
  chown -R "${UID_NUM}:100000" "${USER_HOME}" 2>/dev/null || true
fi

chmod 700 "${USER_HOME}"
chmod 700 "${USER_HOME}/workspace"
chmod 700 "${USER_HOME}/.dsh"

echo "SUCCESS: Provisioned tenant '${USERNAME}' with UID ${UID_NUM} at ${USER_HOME}"
exit 0
