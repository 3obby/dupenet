# Multi-stage build for Next.js web app (standalone output)
FROM node:20-alpine AS builder
WORKDIR /build

# Copy monorepo root + web package.json for dependency install
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/

RUN npm ci --workspace=@dupenet/web

COPY apps/web/ apps/web/

# Build Next.js (standalone output)
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace=@dupenet/web

# Debug: show standalone structure
RUN ls -la apps/web/.next/standalone/ && ls -la apps/web/.next/standalone/*/apps/web/ 2>/dev/null || true

# Runtime — minimal image
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy standalone output — the structure mirrors the builder WORKDIR name
# Builder WORKDIR is /build, so standalone has /build/apps/web/server.js
COPY --from=builder /build/apps/web/.next/standalone/build/apps/web/ ./
COPY --from=builder /build/apps/web/.next/standalone/build/node_modules/ ./node_modules/
COPY --from=builder /build/apps/web/.next/standalone/build/package.json ./package.json

# Copy static assets
COPY --from=builder /build/apps/web/.next/static/ ./.next/static/

EXPOSE 3200
ENV PORT=3200
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
