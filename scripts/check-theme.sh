#!/usr/bin/env bash
# CopyMonster app theme guard.
#
# Color literals (hex, rgb(), hsl()) are permitted only in
# apps/web/src/cm-theme.css, the single source of the --cm-* palette.
set -u

cd "$(dirname "$0")/.." || exit 1

root="apps/web/src"
exempt="$root/cm-theme.css"

violations=$(grep -rEni '#[0-9a-f]{3,8}([^0-9a-f]|$)|rgba?\(|hsla?\(' "$root" \
  --include='*.css' --include='*.ts' --include='*.tsx' 2>/dev/null \
  | grep -v "^${exempt}:" || true)

if [ -n "$violations" ]; then
  echo "check-theme: color literals found outside ${exempt}:" >&2
  printf '%s\n' "$violations" >&2
  exit 1
fi

echo "check-theme: clean"
