#!/usr/bin/env bash
set -euo pipefail

export DISPLAY="${DISPLAY:-:99}"
export HOME="${HOME:-/root}"

mkdir -p /tmp/.X11-unix /run/dbus
if [ ! -e /run/dbus/system_bus_socket ]; then
    dbus-daemon --system --fork >/dev/null 2>&1 || true
fi

if ! pgrep -x Xvfb >/dev/null 2>&1; then
    Xvfb "$DISPLAY" -screen 0 1280x800x24 >/tmp/xvfb.log 2>&1 &
    XVFB_PID=$!
    echo "Xvfb started on $DISPLAY (PID $XVFB_PID)"
else
    echo "Xvfb already running on $DISPLAY"
fi

sleep 1

if ! pgrep -x x11vnc >/dev/null 2>&1; then
    x11vnc -display "$DISPLAY" -forever -shared -nopw -listen 0.0.0.0 -localhost no -rfbport 5900 >/tmp/x11vnc.log 2>&1 &
    X11VNC_PID=$!
    echo "x11vnc listening on 5900 (PID $X11VNC_PID)"
else
    echo "x11vnc already running"
fi

if ! pgrep -x websockify >/dev/null 2>&1; then
    websockify --web /usr/share/novnc 6080 localhost:5900 >/tmp/websockify.log 2>&1 &
    WEBSOCKIFY_PID=$!
    echo "noVNC available at http://127.0.0.1:6080/vnc.html (PID $WEBSOCKIFY_PID)"
else
    echo "websockify already running"
fi

if [ $# -gt 0 ]; then
    echo "Launching: $*"
    "$@"
    exit $?
fi

if command -v thunderbird >/dev/null 2>&1; then
    echo "Launching Thunderbird"
    thunderbird --no-remote &
fi

trap 'kill $(jobs -p) 2>/dev/null || true' EXIT INT TERM
wait
