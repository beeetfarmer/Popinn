FROM node:26-alpine AS deps
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci

FROM deps AS dev
COPY frontend ./
RUN chown -R node:node /app/frontend
USER node
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

FROM deps AS build
COPY frontend ./
RUN npm run build

FROM docker.io/nginxinc/nginx-unprivileged:1.30-alpine AS prod
USER root
RUN apk upgrade --no-cache
COPY deploy/docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY deploy/docker/nginx/05-resolver.sh /docker-entrypoint.d/05-resolver.sh
RUN chmod +x /docker-entrypoint.d/05-resolver.sh
COPY --from=build /app/frontend/dist /usr/share/nginx/html
USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
