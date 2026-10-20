# syntax=docker/dockerfile:1

# ---- build stage: install, build, prune dev dependencies ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# runs per target platform, so sharp and ffmpeg-static fetch matching binaries
RUN npm ci
COPY . .
# SvelteKit's postbuild analysis imports server modules, which validate env at load time.
# These placeholders exist only for this RUN step and are not part of the final image.
RUN ORIGIN=http://localhost:3000 SESSION_SECRET=build-placeholder-build-placeholder-0000 \
    DATABASE_URL=postgres://build:build@localhost:5432/build \
    S3_ENDPOINT=http://localhost:9000 S3_BUCKET=build S3_ACCESS_KEY_ID=build S3_SECRET_ACCESS_KEY=build \
    OIDC_ISSUER=http://localhost:8080/build OIDC_CLIENT_ID=build OIDC_CLIENT_SECRET=build \
    npm run build && npm prune --omit=dev

# ---- runtime stage ----
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
# migrations are resolved relative to the working directory (/app/drizzle)
COPY --from=build --chown=node:node /app/drizzle ./drizzle
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "build"]
