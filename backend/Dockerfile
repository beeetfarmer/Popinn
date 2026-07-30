FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app/backend

RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 10001 popinn && \
    useradd --system --uid 10001 --gid popinn --home-dir /nonexistent --shell /usr/sbin/nologin popinn

COPY backend/requirements.txt /app/backend/requirements.txt
# pip is a build-time tool. Keeping it in the runtime image also keeps its
# vendored dependencies, and those are scanned: pip bundles msgpack 1.1.2, which
# carries a HIGH advisory that no pip release has picked up a fix for yet. The
# application never imports any of it, so the honest fix is to not ship the
# installer at all -- which also drops setuptools and wheel, and a few MB.
# Removed in the same layer as the install, or the files persist in the image.
# pip goes last, since it is what removes the others.
RUN python -m pip install --upgrade pip && \
    python -m pip install -r /app/backend/requirements.txt && \
    python -m pip uninstall -y setuptools wheel || true && \
    python -m pip uninstall -y pip || true

COPY backend /app/backend
RUN chown -R 10001:10001 /app/backend

USER 10001:10001

EXPOSE 8471

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8471/api/v1/health/live || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8471"]
