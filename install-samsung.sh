#!/usr/bin/env bash
# Build, package and install the Samsung target with the Tizen CLI.
# TV_SERIAL: the set's sdb address. CERT_PROFILE: the Tizen signing profile.
set -euo pipefail

TV_SERIAL="${TV_SERIAL:-10.44.1.183:26101}"
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

# The first transfer sometimes fails with "Can not transfer package". Resetting
# sdb fixes it, once its port has left TIME_WAIT.
install_package() {
    tizen install -s "$TV_SERIAL" -n Macha.wgt -- . && return 0

    echo "install-samsung: transfer failed, resetting sdb and retrying once" >&2
    sdb kill-server || true
    for _ in $(seq 1 40); do
        netstat -an | grep -q "26099.*TIME_WAIT" || break
        sleep 3
    done
    sdb start-server || true
    sdb connect "$TV_SERIAL" || true
    tizen install -s "$TV_SERIAL" -n Macha.wgt -- .
}

install_package

# Installing over a running app leaves it resumed, and the first launch then
# foregrounds nothing. A second launch does.
launch_app() {
    local output
    output=$(tizen run -s "$TV_SERIAL" -p "$APP_ID" 2>&1) || true
    printf '%s\n' "$output"
    case "$output" in
        *'successfully launched'*) return 0 ;;
    esac
    echo "install-samsung: first launch did not foreground the app, retrying" >&2
    tizen run -s "$TV_SERIAL" -p "$APP_ID"
}

launch_app
