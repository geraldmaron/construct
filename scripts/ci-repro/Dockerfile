# scripts/ci-repro/Dockerfile — local replica of ci.yml's `test` job
# environment. Build context is the repo's scripts/ directory (see run.sh) so
# this image bakes the SAME scripts/ci/setup-toolchain.sh the workflow runs —
# the tool set cannot drift from CI without failing here too.
#
# Layer order is deliberate: the heavy toolchain layer (apt + pinned binaries)
# comes first and only rebuilds when setup-toolchain.sh changes; Node is
# installed LAST so switching --node 20|22 (ARG NODE_VERSION) reuses the
# toolchain layer instead of re-downloading LibreOffice. Node comes from the
# official nodejs.org dist tarball, verified against the published
# SHASUMS256.txt for that release line.

FROM ubuntu:24.04

RUN apt-get update \
  && apt-get install -y --no-install-recommends git curl ca-certificates xz-utils sudo \
  && rm -rf /var/lib/apt/lists/*

# Non-root mirrors the GitHub Actions runner user; passwordless sudo lets the
# shared setup-toolchain.sh run its apt-get steps exactly as it does on CI.

RUN useradd -m -s /bin/bash runner \
  && echo 'runner ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/runner

USER runner
WORKDIR /home/runner

COPY --chown=runner:runner ci/setup-toolchain.sh /repro/setup-toolchain.sh
RUN bash /repro/setup-toolchain.sh && sudo rm -rf /var/lib/apt/lists/*
ENV PATH="/home/runner/.local/bin:${PATH}"

ARG NODE_VERSION=22
RUN set -eu; \
  arch="$(uname -m)"; \
  case "$arch" in \
    x86_64) narch=x64 ;; \
    aarch64) narch=arm64 ;; \
    *) echo "unsupported arch: $arch" >&2; exit 1 ;; \
  esac; \
  curl -fsSL --retry 3 -o /tmp/SHASUMS256.txt "https://nodejs.org/dist/latest-v${NODE_VERSION}.x/SHASUMS256.txt"; \
  tarball="$(grep -o "node-v${NODE_VERSION}\.[0-9]*\.[0-9]*-linux-${narch}\.tar\.xz" /tmp/SHASUMS256.txt | head -1)"; \
  test -n "$tarball"; \
  curl -fsSL --retry 3 -o "/tmp/${tarball}" "https://nodejs.org/dist/latest-v${NODE_VERSION}.x/${tarball}"; \
  cd /tmp && grep "  ${tarball}\$" SHASUMS256.txt | sha256sum -c -; \
  sudo tar -xJf "/tmp/${tarball}" -C /usr/local --strip-components=1; \
  rm -f "/tmp/${tarball}" /tmp/SHASUMS256.txt; \
  node --version && npm --version

COPY --chown=runner:runner ci-repro/job-test.sh /repro/job-test.sh
