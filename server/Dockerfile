FROM node:20-alpine AS base
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

RUN chmod +x docker-entrypoint.sh

ENV HOST=0.0.0.0
ENV PORT=3001

VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

EXPOSE 3001
ENTRYPOINT ["./docker-entrypoint.sh"]
