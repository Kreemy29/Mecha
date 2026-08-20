# OneUp — one container running BOTH processes.
#
# The UI and the worker talk only through the SQLite file and the storage
# directory, and a Render disk attaches to exactly one service — so splitting
# them into separate services would require Postgres + object storage. One
# container with a supervisor keeps the architecture intact.
#
# Node 22, not 24: better-sqlite3 has no prebuilt binary for Node 24's ABI.
FROM node:22-bookworm-slim

# ffmpeg/ffprobe are load-bearing — every frame extract, trim and re-encode
# shells out to them. build-essential + python3 are needed to compile
# better-sqlite3 from source.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        python3 \
        build-essential \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first so a code-only change doesn't reinstall them. Dev
# dependencies are kept: the worker runs through tsx.
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV PORT=3000
EXPOSE 3000

CMD ["node", "scripts/start-all.mjs"]
