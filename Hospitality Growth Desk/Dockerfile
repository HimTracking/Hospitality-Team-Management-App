FROM node:24-alpine

WORKDIR /app
ENV HOST=0.0.0.0 PORT=3031 NODE_ENV=production

COPY server.cjs package.json ./
COPY public ./public
RUN mkdir -p /app/data/uploads /app/data/audits /app/data/reports \
    && chown -R node:node /app/data

USER node
EXPOSE 3031
CMD ["node", "server.cjs"]
