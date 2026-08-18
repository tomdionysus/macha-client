#!/usr/bin/env bash
set -euo pipefail

TV_SERIAL="${TV_SERIAL:-10.44.1.177:26101}"
CERT_PROFILE="${CERT_PROFILE:-macha-tv-samsung}"
APP_ID="macha00001.Macha"

rm -rf dist
npm run build-samsung

cd dist
rm -f Macha.wgt

tizen package \
    -t wgt \
    -s "$CERT_PROFILE" \
    -- .

tizen install \
    -s "$TV_SERIAL" \
    -n Macha.wgt \
    -- .

tizen run \
    -s "$TV_SERIAL" \
    -p "$APP_ID"
