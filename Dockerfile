## Dockerfile for TLSCheckin application

## Stage for installing dependencies
FROM node:20-alpine AS deps 

WORKDIR /app

## Install necessary build tools for compiling native modules
RUN apk add --no-cache python3 make g++

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
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
ARG APP_PORT=9110
ENV PORT=${APP_PORT}

WORKDIR /app

## Install runtime dependencies
RUN apk add --no-cache libstdc++
COPY package*.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY --from=build /app/public public
COPY --from=build /app/checkins.json checkins.json

EXPOSE ${APP_PORT}
CMD ["npm", "start"]

