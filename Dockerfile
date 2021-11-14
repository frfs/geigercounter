FROM node:17-alpine AS base

WORKDIR /geigercounter

FROM base AS builder

COPY . ./
RUN npm install && npm run build && rm -rf .git

FROM base AS runner

RUN apk add --no-cache tini

ENTRYPOINT ["/sbin/tini", "--"]

COPY --from=builder /geigercounter/node_modules ./node_modules
COPY --from=builder /geigercounter/lib ./lib

CMD node ./lib/index.js
