FROM node:20-alpine AS build
WORKDIR /app
COPY server/package*.json ./
RUN npm ci
COPY server/tsconfig.json server/*.ts ./
RUN npm run build

FROM node:20-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
