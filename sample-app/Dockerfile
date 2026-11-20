FROM node:22-alpine
WORKDIR /app
COPY server.mjs index.html site.css site.js ./
USER 101:101
EXPOSE 8080
CMD ["node", "server.mjs"]
