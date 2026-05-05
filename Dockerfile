FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY server ./server
COPY web ./web
COPY shared ./shared
COPY vendor ./vendor
COPY docker/entrypoint.sh /app/docker/entrypoint.sh

RUN chmod +x /app/docker/entrypoint.sh

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4000
ENV DATA_ROOT=/app/data

VOLUME ["/app/data"]

EXPOSE 4000

CMD ["/app/docker/entrypoint.sh"]
