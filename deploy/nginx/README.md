# Popinn Nginx (Non-Docker)

## What this config does
- Serves built frontend from `frontend/dist`.
- Reverse-proxies API requests from `/api/*` to FastAPI on `127.0.0.1:8471`.
- Serves `/media/*` directly from local media path with byte-range support for scrubbing.
- Serves HLS playlists/segments under `/media/.hls/*`.
- Adds basic security headers and API request rate limiting at the edge.

> This config is for running Popinn **without containers**. For the normal
> Docker/Podman deployment see [../../docs/installation.md](../../docs/installation.md);
> the `web` container already ships an equivalent nginx setup.

## Paths to change before use

`/opt/popinn` throughout these files is a placeholder for wherever you checked
the repository out. Nginx needs absolute paths, so substitute your own:

```bash
POPINN_DIR=/path/to/your/checkout
sed -i "s#/opt/popinn#$POPINN_DIR#g" \
  deploy/nginx/nginx.conf deploy/nginx/conf.d/popinn.conf
```

Also review, in `deploy/nginx/conf.d/popinn.conf`:

- `root` — must point at `frontend/dist`
- the `alias` media path

## Start commands
```bash
cd /opt/popinn/frontend
npm run build

sudo nginx -t -c /opt/popinn/deploy/nginx/nginx.conf
sudo nginx -c /opt/popinn/deploy/nginx/nginx.conf
```

## Reload after config changes
```bash
sudo nginx -t -c /opt/popinn/deploy/nginx/nginx.conf
sudo nginx -s reload -c /opt/popinn/deploy/nginx/nginx.conf
```
