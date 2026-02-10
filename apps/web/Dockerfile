# Multi-stage build for Next.js web app (standalone output)
FROM node:20-alpine AS builder
WORKDIR /app

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

# Copy standalone output (preserves monorepo structure)
COPY --from=builder /app/apps/web/.next/standalone/ ./

# Copy static assets into standalone structure
COPY --from=builder /app/apps/web/.next/static/ ./dupenet/apps/web/.next/static/

# Copy public dir if it exists (currently none, but future-proof)
# COPY --from=builder /app/apps/web/public/ ./dupenet/apps/web/public/

WORKDIR /app/dupenet/apps/web

EXPOSE 3200
ENV PORT=3200
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
