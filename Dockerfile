FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:docker

# Official multi-platform manifest digest for nginx-unprivileged 1.30.4-alpine3.24,
# published by nginx/docker-nginx-unprivileged and checked 2026-08-25:
# https://github.com/nginx/docker-nginx-unprivileged/pkgs/container/nginx-unprivileged
FROM ghcr.io/nginx/nginx-unprivileged:1.30.4-alpine3.24@sha256:44e36330f74d4f3a1d4e222acca9e23b401fb87811a7597024502bb759c4dd49
COPY --from=build /app/dist-docker /usr/share/nginx/html
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/nginx/html/
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/security-headers.conf /etc/nginx/security-headers.conf
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
USER 101
