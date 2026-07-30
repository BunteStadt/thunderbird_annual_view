# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    DISPLAY=:99

WORKDIR /workspace

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        thunderbird \
        xvfb \
        scrot \
        xdotool \
        git \
        procps \
        python3 \
        ca-certificates \
        dbus-x11 \
    && rm -rf /var/lib/apt/lists/*

COPY . /workspace

RUN git config --global --add safe.directory /workspace

CMD ["bash"]
