# Thin OpenSandbox lifecycle server image. We ship our own minimal image
# instead of relying on `opensandbox/server:latest` because it isn't always
# available on Docker Hub mirrors. The actual server is just the
# `opensandbox-server` Python package.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir \
      --trusted-host pypi.org --trusted-host files.pythonhosted.org \
      opensandbox-server

# Tell the server it's running non-interactively so it doesn't prompt for the
# YES acknowledgement when started without an API key.
ENV OPENSANDBOX_INSECURE_SERVER=YES

EXPOSE 8080

# `SANDBOX_CONFIG_PATH` is provided by docker-compose configs; the server
# uses it to find the toml.
CMD ["opensandbox-server"]
