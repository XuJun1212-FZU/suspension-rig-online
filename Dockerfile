FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
COPY package.json ./
COPY .openai ./.openai
COPY scripts ./scripts
COPY web ./web
COPY worker ./worker
COPY drizzle ./drizzle
RUN node scripts/build.mjs && mkdir -p /data && chmod 700 /data
EXPOSE 3000
CMD ["node", "scripts/serve.mjs"]
