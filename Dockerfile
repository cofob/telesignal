# syntax=docker/dockerfile:1
# The all-in-one TeleSignal image: the built web app, nginx and the tunnel (`proxy/`) in one container. nginx serves the
# app and relays `/tunnel` to the tunnel on loopback. Build with `docker build -t telesignal .`; deployment, settings and
# the environment variables: docs/DEPLOY.md.
#
# The web app and the tunnel are built on the build machine (`$BUILDPLATFORM`) for every target platform, so that no
# compiler runs under emulation: the bundle is the same for every architecture, and the tunnel is cross-compiled. Only
# the last stage, which installs packages and copies files, is built for the target platform. The base images are
# pinned by digest, which Dependabot keeps current together with the tags.

FROM --platform=$BUILDPLATFORM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS web
# `npm ci` fetches five packages from GitHub, two of which (`opus-recorder` and `emoji-data-ios`) the app uses at run
# time, so the stage needs `git`
# hadolint ignore=DL3018
RUN apk add --no-cache git brotli
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# The install scripts only clear the local cache directory of the repository
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts
# Web K (`webk/`, the frontend at `/k/`) has dependencies of its own, locked by pnpm
COPY webk/package.json webk/pnpm-lock.yaml webk/pnpm-workspace.yaml ./webk/
COPY webk/patches ./webk/patches
RUN --mount=type=cache,target=/root/.npm npm run install:webk -- --ignore-scripts
COPY index.html vite.config.ts tsconfig.json tsconfig.base.json postcss.config.ts ./
COPY dev ./dev
COPY plugins ./plugins
COPY public ./public
COPY src ./src
COPY webk ./webk
# The page's own policy comes from `buildCsp` in `vite.config.ts`. nginx sends it as a header too (a worker takes its
# policy from its own response headers, and `frame-ancestors` cannot be in a `<meta>` tag), so the policy is read back
# from the built page and cannot drift from the source. So is the frontend that `/` opens (`plugins/frontends.ts`). The image ships no source maps and no references to them.
RUN NODE_OPTIONS=--max-old-space-size=8192 npm run build:production \
  && mkdir -p /out \
  && sed -n 's/.*http-equiv="Content-Security-Policy" content="\([^"]*\)".*/\1/p' dist/a/index.html > /out/csp.txt \
  && test -s /out/csp.txt \
  && grep -q "connect-src 'self'" /out/csp.txt \
  && sed -n 's/.*data-frontend="\([^"]*\)".*/\1/p' dist/index.html > /out/default-frontend.txt \
  && test -s /out/default-frontend.txt \
  && find dist -name '*.map' -delete \
  && find dist -type f \( -name '*.js' -o -name '*.css' \) \
    -exec sed -i -E '/^(\/\/|\/\*)# sourceMappingURL=[^ ]+\.map( \*\/)?$/d' {} +
# Precompressed copies for `gzip_static` and `brotli_static`. The pages (`index.html` of each frontend) stay plain because
# nginx edits them on the fly when `PUBLIC_URL` or `CSP_CONNECT_SRC` is set.
# hadolint ignore=DL4006,SC2016
RUN find dist -type f -size +512c ! -name index.html \
    \( -name '*.js' -o -name '*.css' -o -name '*.wasm' -o -name '*.svg' -o -name '*.json' -o -name '*.webmanifest' \
       -o -name '*.html' -o -name '*.ico' \) -print0 \
  | xargs -0 -r -P "$(nproc)" -n 1 sh -c 'gzip -9 -k -f "$1" && brotli -q 11 -k -f "$1"' sh

FROM --platform=$BUILDPLATFORM rust:1.98.1-alpine@sha256:7cc1c22d77d9432f7fe012a70e6d3e555af54c2a6832700ed7d553f1769ae89f AS tunnel
ARG TARGETARCH
# The tunnel has no C dependencies, so `rust-lld` links the arm64 binary on an amd64 build machine without a cross
# compiler. The amd64 build uses the system linker, which the build scripts and procedural macros of both need.
ENV CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER=rust-lld
# hadolint ignore=DL3018
RUN apk add --no-cache musl-dev
WORKDIR /src
RUN case "$TARGETARCH" in \
      amd64) echo x86_64-unknown-linux-musl ;; \
      arm64) echo aarch64-unknown-linux-musl ;; \
      *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac > /target \
  && rustup target add "$(cat /target)"
COPY proxy/Cargo.toml proxy/Cargo.lock ./
COPY proxy/src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo build --release --locked --target "$(cat /target)" \
  && install -D "target/$(cat /target)/release/telesignal-tunnel" /out/telesignal-tunnel

FROM alpine:3.23@sha256:469c9ea410b9215eaee7976ba6c0639039b444be8e5d638f7abbada189971eb2 AS runtime
ARG VERSION
ARG REVISION
LABEL org.opencontainers.image.title="TeleSignal" \
      org.opencontainers.image.description="TeleSignal web app with nginx and the tunnel to Signal servers" \
      org.opencontainers.image.source="https://github.com/cofob/signal-tg" \
      org.opencontainers.image.documentation="https://github.com/cofob/signal-tg/blob/master/docs/DEPLOY.md" \
      org.opencontainers.image.licenses="GPL-3.0-only" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

# `tini` reaps processes and forwards signals to the entrypoint, which supervises nginx and the tunnel
# hadolint ignore=DL3018
RUN apk add --no-cache nginx nginx-mod-http-brotli envsubst tini \
  && rm -rf /etc/nginx/nginx.conf /etc/nginx/http.d /etc/nginx/conf.d \
  && mkdir -p /etc/nginx/conf.d /etc/nginx/templates /usr/share/telesignal

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/templates/ /etc/nginx/templates/
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/telesignal-entrypoint
COPY --from=tunnel --chmod=755 /out/telesignal-tunnel /usr/local/bin/telesignal-tunnel
COPY --from=web /out/csp.txt /usr/share/telesignal/csp.txt
COPY --from=web /out/default-frontend.txt /usr/share/telesignal/default-frontend.txt
COPY --from=web /app/dist /srv/telesignal

# Nothing but `/tmp` is written at run time, so the root file system may be read-only (`docker run --read-only --tmpfs
# /tmp`): nginx keeps its temporary files and the rendered configuration there
ENV NGINX_PORT=8080 \
    TUNNEL_PORT=8787
EXPOSE 8080
USER 65532:65532
# The shell form expands `NGINX_PORT` at run time
# hadolint ignore=DL3025
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${NGINX_PORT}/healthz" || exit 1
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/telesignal-entrypoint"]
