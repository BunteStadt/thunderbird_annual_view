#!/bin/sh

set -e # Exit immediately if a command exits with a non-zero status.
set -u # Treat unset variables as an error.

cd /config
/usr/local/bin/prepare-thunderbird-profile.sh >/dev/null 2>&1 || true

exec /bin/sh -c 'trap : TERM INT; while true; do sleep 3600; done'

# vim:ft=sh:ts=4:sw=4:et:sts=4
