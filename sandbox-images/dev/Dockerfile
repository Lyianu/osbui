# ----------------------------------------------------------------------
# osbui/dev — an "all-in-one" sandbox image for the OpenSandbox panel.
# Built on top of opensandbox/vscode:latest (code-server + Debian) and
# pre-loads the dev tools we expose in the panel's Services tab.
# ----------------------------------------------------------------------
FROM opensandbox/vscode:latest

USER root

# System packages: build tools, git, common CLI utilities, postgres + redis
# clients (so connect-from-sandbox examples work even without an external DB),
# and the headers Python/Node packages tend to want.
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      build-essential pkg-config \
      git curl wget unzip zip jq htop procps \
      ca-certificates gnupg lsb-release \
      sqlite3 \
      postgresql-client redis-tools \
      vim nano tmux \
      python3-venv python3-dev \
 && rm -rf /var/lib/apt/lists/*

# Node + npm (from Debian — adds `nodejs` and `npm` together).
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nodejs npm \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g --silent yarn pnpm 2>/dev/null || true

# Common Python packages used by the panel's Services tab. The
# `--trusted-host` flags make this build robust behind corporate / dev
# environments that intercept HTTPS — they're a no-op when SSL works.
RUN python3 -m pip install --break-system-packages --no-cache-dir \
      --trusted-host pypi.org --trusted-host files.pythonhosted.org \
      jupyterlab \
      streamlit \
      ipykernel \
      requests httpx \
      pandas numpy \
      pytest

# Workspace directory + non-root vscode user already exist in the base image.
RUN mkdir -p /workspace && chown -R vscode:vscode /workspace

USER vscode
WORKDIR /workspace

# The OpenSandbox server will inject its execd entrypoint; the CMD here just
# keeps the container alive when run standalone (e.g. for testing).
CMD ["sleep", "infinity"]
