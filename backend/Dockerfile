FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app/backend

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 10001 popinn && \
    useradd --system --uid 10001 --gid popinn --home-dir /nonexistent --shell /usr/sbin/nologin popinn

COPY backend/requirements.txt /app/backend/requirements.txt
RUN python -m pip install --upgrade pip && \
    python -m pip install -r /app/backend/requirements.txt

COPY backend /app/backend
RUN chown -R 10001:10001 /app/backend

USER 10001:10001

EXPOSE 8471

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8471"]
