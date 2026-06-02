# --- build stage --------------------------------------------------------------
# Use a fully-qualified registry ref (docker.io/...): the platform build runs
# buildah in short-name-mode=enforcing, which rejects bare `node:20-alpine`.
FROM docker.io/library/node:20-alpine AS build
WORKDIR /app

# pnpm via corepack. The example builds standalone (no workspace) once tiged'd,
# so a plain `pnpm install` resolves @civitai/* from npm.
RUN corepack enable
COPY package.json ./
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN pnpm build

# --- runtime stage ------------------------------------------------------------
# GOTCHA #37: MUST be nginxinc/nginx-unprivileged, NOT plain nginx:alpine.
# The platform's apply-Job smoke step admits the pod under runAsNonRoot=true.
# The unprivileged image bakes a numeric `USER 101` into its metadata AND
# redirects every writable nginx path to /tmp, so the non-root process starts.
# Plain nginx:alpine fails BOTH and the deploy hangs at the smoke probe.
FROM docker.io/nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# nginx-unprivileged listens on 8080 (non-root can't bind 80). The platform
# Service + smoke probe both target 8080.
EXPOSE 8080
