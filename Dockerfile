# syntax=docker/dockerfile:1

# ---------- build stage: compile TypeScript ----------
# alpine is safe here: every runtime dependency (pg, ioredis, pino, socket.io, …) is pure JS,
# so there's no native toolchain to satisfy and the image stays small.
FROM node:26-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- runtime stage: prod deps + compiled output only ----------
FROM node:26-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

EXPOSE 5000

# Liveness: hits the /health route (no curl/wget in the alpine base — use node's fetch).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Run pending migrations, then exec into node so SIGTERM reaches the app directly and the
# graceful shutdown (stop sweeper, close sockets/server, destroy DataSource) actually runs.
# (An `npm start` wrapper would swallow the signal.)
CMD ["sh", "-c", "npm run migration:run:prod && exec node dist/server.js"]
