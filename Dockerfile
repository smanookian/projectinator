# Projectinator in a container — Node 22 + headless Chromium (so the Tester really runs
# the apps) + git. Projects and settings live on volumes so they survive image upgrades.
#
#   docker build -t projectinator .
#   docker run -it --rm \
#     -e OPENROUTER_API_KEY \
#     -v projectinator-home:/data \
#     projectinator                     # the cockpit
#   docker run -it --rm -e ANTHROPIC_API_KEY -v projectinator-home:/data \
#     projectinator build "a tip calculator" --yes
#
# /data/config      → ~/.projectinator (keys, prefs)     /data/projects → every build
# Non-static stacks (vite/node) install and run inside the container; the Tester's server
# ports never need publishing (it drives Chromium in-container).

FROM mcr.microsoft.com/playwright:v1.61.1-noble

ARG VERSION=latest
ENV NODE_ENV=production \
    PROJECTINATOR_HOME=/data \
    HOME=/data/config \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    TERM=xterm-256color

RUN apt-get update && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g "projectinator@${VERSION}" \
 && mkdir -p /data/config /data/projects \
 && git config --system user.email projectinator@localhost \
 && git config --system user.name Projectinator \
 && git config --system --add safe.directory '*'

VOLUME ["/data"]
WORKDIR /data
ENTRYPOINT ["projectinator"]
