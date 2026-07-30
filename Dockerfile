# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    DISPLAY=:99

WORKDIR /workspace

RUN set -eux; \
    (apt-get update || true); \
    (apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        wget \
        gnupg \
        lsb-release \
        apt-transport-https \
        software-properties-common \
        xvfb \
        scrot \
        xdotool \
        git \
        procps \
        python3 \
        zip \
        unzip \
        dbus-x11 \
        x11vnc \
        novnc \
        websockify \
        xauth \
    ); \
    install -d -m 0755 /etc/apt/keyrings; \
    if wget -q https://packages.mozilla.org/apt/repo-signing-key.gpg -O /tmp/packages.mozilla.org.asc; then \
        install -m 0644 /tmp/packages.mozilla.org.asc /etc/apt/keyrings/packages.mozilla.org.gpg; \
        chmod 644 /etc/apt/keyrings/packages.mozilla.org.gpg; \
        echo 'deb [signed-by=/etc/apt/keyrings/packages.mozilla.org.gpg] https://packages.mozilla.org/apt mozilla main' > /etc/apt/sources.list.d/mozilla.list; \
        printf 'Package: *\nPin: origin packages.mozilla.org\nPin-Priority: 1000\n' > /etc/apt/preferences.d/mozilla; \
        (apt-get update || true); \
        (apt-get install -y --no-install-recommends thunderbird || true); \
    fi; \
    if ! command -v thunderbird >/dev/null 2>&1; then \
        (apt-get install -y --no-install-recommends thunderbird || true); \
    fi; \
    if [ -n "${THUNDERBIRD_DEB_URL:-}" ]; then \
        installed_version=$(thunderbird --version 2>/dev/null | awk '{print $3}' | head -1 || true); \
        major_version=$(printf '%s\n' "$installed_version" | sed -E 's/^([0-9]+).*/\1/'); \
        if [ -z "$major_version" ] || [ "$major_version" -lt 153 ]; then \
            curl -fsSL "$THUNDERBIRD_DEB_URL" -o /tmp/thunderbird.deb; \
            (apt-get install -y --no-install-recommends /tmp/thunderbird.deb || dpkg -i /tmp/thunderbird.deb || true); \
        fi; \
    fi; \
    (thunderbird --version || true); \
    rm -rf /var/lib/apt/lists/* /tmp/packages.mozilla.org.asc /tmp/thunderbird.deb

COPY . /workspace
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY scripts/start-gui.sh /usr/local/bin/start-gui.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh /usr/local/bin/start-gui.sh \
    && git config --global --add safe.directory /workspace

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["bash"]
