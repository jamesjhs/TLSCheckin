## Dockerfile for TLSCheckin application

## Stage for installing dependencies
FROM node:22-bookworm-slim AS deps 

WORKDIR /app

## Install necessary build tools for compiling native modules
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

## Stage for building the application
FROM deps AS build
COPY tsconfig.json ./
COPY src src
COPY public public
COPY checkins.json checkins.json
RUN npm run build
RUN npm prune --omit=dev

## Stage for running the application
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ARG APP_PORT=3110
ENV PORT=${APP_PORT}

WORKDIR /app

COPY package*.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY --from=build /app/public public
COPY --from=build /app/checkins.json checkins.json

EXPOSE ${APP_PORT}
CMD ["npm", "start"]

