# Multi-stage build for mint
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/physics/package.json packages/physics/
COPY packages/lnd-client/package.json packages/lnd-client/
COPY apps/mint/package.json apps/mint/

RUN npm ci --workspace=@dupenet/mint

COPY packages/physics/ packages/physics/
COPY packages/lnd-client/ packages/lnd-client/
COPY apps/mint/ apps/mint/
COPY tsconfig.base.json .

RUN npm run build --workspace=@dupenet/physics
RUN npm run build --workspace=@dupenet/lnd-client
RUN npm run build --workspace=@dupenet/mint

# Runtime
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/packages/physics/dist packages/physics/dist/
COPY --from=builder /app/packages/physics/package.json packages/physics/
COPY --from=builder /app/packages/lnd-client/dist packages/lnd-client/dist/
COPY --from=builder /app/packages/lnd-client/package.json packages/lnd-client/
COPY --from=builder /app/apps/mint/dist apps/mint/dist/
COPY --from=builder /app/apps/mint/package.json apps/mint/

EXPOSE 3101
CMD ["node", "apps/mint/dist/server.js"]
