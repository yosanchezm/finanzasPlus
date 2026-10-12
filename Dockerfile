# syntax=docker/dockerfile:1

# ---- build: compile the Vite SPA ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_* values into the browser bundle at build time,
# so they must be provided as build args (Dokploy → Build Args), not runtime env.
ARG VITE_APPWRITE_ENDPOINT
ARG VITE_APPWRITE_PROJECT_ID
ARG VITE_APPWRITE_DATABASE_ID
ARG VITE_APPWRITE_HOUSEHOLD_ID
ARG VITE_APPWRITE_HOUSEHOLD_TEAM_ID
ARG VITE_APPWRITE_RECEIPTS_BUCKET_ID=receipts
ARG VITE_APPWRITE_CURRENCY=COP

# Fail fast instead of shipping a bundle with an empty Appwrite config.
RUN for name in VITE_APPWRITE_ENDPOINT VITE_APPWRITE_PROJECT_ID VITE_APPWRITE_DATABASE_ID \
      VITE_APPWRITE_HOUSEHOLD_ID VITE_APPWRITE_HOUSEHOLD_TEAM_ID; do \
      eval "value=\${$name}"; \
      if [ -z "$value" ]; then echo "Missing build arg: $name" >&2; exit 1; fi; \
    done \
 && npm run build

# ---- runtime: static files served by Nginx ----
FROM nginx:1.28-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

# 127.0.0.1, not localhost: localhost may resolve to ::1 while Nginx listens on IPv4 only.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:80/health || exit 1
