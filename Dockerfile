FROM node:22-alpine

WORKDIR /app

COPY . .

EXPOSE 9000

CMD ["node", "src/server.js"]