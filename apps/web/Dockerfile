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

# Runtime — minimal image
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy entire standalone output (preserves relative structure)
# Standalone structure: apps/web/server.js, apps/web/.next/, node_modules/, package.json
COPY --from=builder /build/apps/web/.next/standalone/ ./

# Copy static assets into the web app's .next directory
COPY --from=builder /build/apps/web/.next/static/ ./apps/web/.next/static/

WORKDIR /app/apps/web

EXPOSE 3200
ENV PORT=3200
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
