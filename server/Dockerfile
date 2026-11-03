# Zero npm dependencies: just Node 22 and the source.
FROM node:22-slim
WORKDIR /app
COPY package.json models.json ./
COPY src ./src
COPY public ./public
ENV NODE_ENV=production \
    PORT=8787 \
    DB_PATH=/data/realms.db
RUN mkdir -p /data
EXPOSE 8787
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.ts"]
