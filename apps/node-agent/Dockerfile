# Multi-stage build for node-agent
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/physics/package.json packages/physics/
COPY apps/node-agent/package.json apps/node-agent/

RUN npm ci --workspace=@dupenet/node-agent

COPY packages/physics/ packages/physics/
COPY apps/node-agent/ apps/node-agent/
COPY tsconfig.base.json .

RUN npm run build --workspace=@dupenet/physics
RUN npm run build --workspace=@dupenet/node-agent

# Runtime
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/packages/physics/dist packages/physics/dist/
COPY --from=builder /app/packages/physics/package.json packages/physics/
COPY --from=builder /app/apps/node-agent/dist apps/node-agent/dist/
COPY --from=builder /app/apps/node-agent/package.json apps/node-agent/

CMD ["node", "apps/node-agent/dist/index.js"]
