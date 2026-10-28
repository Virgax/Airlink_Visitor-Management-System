# ops/backup: pg_dump (matching the Railway Postgres major version) + the repo's backup script.
FROM node:22-bookworm-slim
ARG PG_MAJOR=18
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update && apt-get install -y --no-install-recommends postgresql-client-${PG_MAJOR} \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
# tsx and dotenv are runtime dependencies (start:prod, cron:tick, ops:backup), so --omit=dev keeps them.
RUN npm ci --omit=dev --ignore-scripts && npx prisma generate
COPY scripts ./scripts
CMD ["npm", "run", "ops:backup"]
