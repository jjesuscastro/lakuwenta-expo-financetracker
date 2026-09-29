FROM node:22-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mobile/package.json apps/mobile/package.json
RUN npm ci

COPY . .

ARG EXPO_PUBLIC_API_URL=/api
ENV EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL}

RUN npm --workspace apps/api run build \
  && npm --workspace apps/mobile run build:web

FROM node:22-bookworm-slim AS api-dependencies

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mobile/package.json apps/mobile/package.json
RUN npm ci --omit=dev --workspace apps/api --include-workspace-root=false

FROM node:22-bookworm-slim AS api

ENV NODE_ENV=production \
  PORT=3000 \
  DATABASE_PATH=/data/lakuenta.sqlite \
  ENV_FILE=/dev/null

WORKDIR /app
COPY --from=api-dependencies /workspace/node_modules ./node_modules
COPY apps/api/package.json ./apps/api/package.json
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/apps/api/sql ./apps/api/sql
RUN mkdir -p /data && chown node:node /data

WORKDIR /app/apps/api
USER node
EXPOSE 3000
CMD ["node", "dist/src/server.js"]

FROM nginx:alpine AS web

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/mobile/dist/ /usr/share/nginx/html/
EXPOSE 80
