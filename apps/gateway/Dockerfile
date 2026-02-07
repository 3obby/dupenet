# Multi-stage build for gateway
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/physics/package.json packages/physics/
COPY apps/gateway/package.json apps/gateway/

RUN npm ci --workspace=@dupenet/gateway

COPY packages/physics/ packages/physics/
COPY apps/gateway/ apps/gateway/
COPY tsconfig.base.json .

RUN npm run build --workspace=@dupenet/physics
RUN npm run build --workspace=@dupenet/gateway

# Runtime
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/packages/physics/dist packages/physics/dist/
COPY --from=builder /app/packages/physics/package.json packages/physics/
COPY --from=builder /app/apps/gateway/dist apps/gateway/dist/
COPY --from=builder /app/apps/gateway/package.json apps/gateway/

EXPOSE 3100
CMD ["node", "apps/gateway/dist/server.js"]
