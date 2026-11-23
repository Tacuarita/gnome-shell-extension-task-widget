#!/usr/bin/env bash
set -euo pipefail

# Usage: bash tests/run.sh /absolute/path/to/extension.zip [test-script.js]
# Isolate backend services as well as Shell, so no real task data is used.
test_root=$(mktemp -d /tmp/task-widget-tests.XXXXXX)
# A portal mount can briefly outlive the isolated session.
trap 'rm -rf "$test_root" 2>/dev/null || :' EXIT
export XDG_DATA_HOME="$test_root/data"
export XDG_CONFIG_HOME="$test_root/config"
export XDG_CACHE_HOME="$test_root/cache"
export XDG_RUNTIME_DIR="$test_root/runtime"
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
export SHELL_BACKGROUND_IMAGE="$test_root/background.svg"
printf '%s\n' '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#234"/></svg>' > "$SHELL_BACKGROUND_IMAGE"
test_script=${2:-"$(dirname "$0")/task-editing.js"}
timeout -k 3s 45s dbus-run-session gnome-shell-test-tool \
    --headless --extension "${1:?Pass the built extension ZIP}" \
    "$(realpath "$test_script")"
