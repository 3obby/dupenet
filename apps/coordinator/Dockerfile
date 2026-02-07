# Multi-stage build for coordinator
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/physics/package.json packages/physics/
COPY apps/coordinator/package.json apps/coordinator/

RUN npm ci --workspace=@dupenet/coordinator

COPY packages/physics/ packages/physics/
COPY apps/coordinator/ apps/coordinator/
COPY tsconfig.base.json .

RUN npm run build --workspace=@dupenet/physics
RUN npx prisma generate --schema=apps/coordinator/prisma/schema.prisma
RUN npm run build --workspace=@dupenet/coordinator

# Runtime
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/packages/physics/dist packages/physics/dist/
COPY --from=builder /app/packages/physics/package.json packages/physics/
COPY --from=builder /app/apps/coordinator/dist apps/coordinator/dist/
COPY --from=builder /app/apps/coordinator/package.json apps/coordinator/
COPY --from=builder /app/apps/coordinator/prisma apps/coordinator/prisma/

EXPOSE 3102
CMD ["node", "apps/coordinator/dist/server.js"]
