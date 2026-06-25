FROM node:20-alpine

WORKDIR /app

RUN corepack enable

COPY . .

RUN pnpm install --filter @nodezero/relay-service... --ignore-scripts && pnpm --filter @nodezero/relay-service build

ENV NODE_ENV=production
ENV RELAY_PORT=8080

EXPOSE 8080

CMD ["pnpm", "--filter", "@nodezero/relay-service", "start"]