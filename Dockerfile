# syntax=docker/dockerfile:1

# ---------- build stage: compile TypeScript ----------
# bookworm-slim (glibc), NOT alpine: better-sqlite3 ships prebuilt glibc binaries, so no
# python3/make/g++ toolchain is needed in the image.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- runtime stage: prod deps + compiled output only ----------
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# ./db is the SQLite location (data-source.ts uses ./db/db.sqlite, relative to WORKDIR).
# Mount a volume here (see docker-compose.yml) or the data dies with the container.
RUN mkdir -p db

EXPOSE 5000

# Liveness: hits the /health route (no curl/wget in slim — use node's fetch).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Run pending migrations, then exec into node so SIGTERM reaches the app directly and the
# graceful shutdown (stop sweeper, close sockets/server, destroy DataSource) actually runs.
# (An `npm start` wrapper would swallow the signal.)
CMD ["sh", "-c", "npm run migration:run:prod && exec node dist/server.js"]
