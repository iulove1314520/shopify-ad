FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY server/package.json /app/server/package.json

WORKDIR /app/server

RUN npm install --omit=dev

COPY server /app/server

RUN mkdir -p /app/data

ENV NODE_ENV=production

EXPOSE 38417

CMD ["npm", "start"]
