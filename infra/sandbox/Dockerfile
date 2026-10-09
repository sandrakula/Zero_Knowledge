# ZEROK-3 sandbox image.
#
# Runs untrusted Python code. The hard security boundary is applied at
# runtime by DockerSandbox (`docker run` flags): network=none, read-only
# rootfs, non-root user, dropped capabilities, memory/cpu/pids limits and
# a host-side timeout. This image only supplies a minimal Python runtime and
# a dedicated unprivileged user.
#
# Build:
#   docker build -t zero-knowledge/sandbox:latest infra/sandbox

FROM python:3.11-slim

ENV LANG=C.UTF-8 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp

# Dedicated non-root user. The numeric uid/gid is mirrored by DockerSandbox
# (`--user 10001:10001`), so the sandbox never runs as root even if an image
# is accidentally reused without its USER directive.
RUN groupadd --gid 10001 sandbox \
    && useradd --uid 10001 --gid 10001 --shell /usr/sbin/nologin sandbox

# Replaced by a read-only bind mount at runtime. Created here so the path
# exists and the image is self-describing.
RUN mkdir -p /work

USER sandbox
WORKDIR /work

CMD ["python", "/work/main.py"]
