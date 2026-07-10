# syntax=docker/dockerfile:1

# ---- deps ------------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ---- build -----------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Cloudflare Web Analytics token. Baked in at build so statically-prerendered
# pages (/, /demos, ...) also carry the beacon; the same value is passed as a
# runtime env in compose so dynamic pages pick it up too. Optional/empty = off.
ARG CF_BEACON_TOKEN=""
ENV CF_BEACON_TOKEN=$CF_BEACON_TOKEN
RUN npm run build

# ---- runtime (standalone) --------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
