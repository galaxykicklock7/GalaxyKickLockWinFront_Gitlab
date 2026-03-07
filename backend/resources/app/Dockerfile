FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --production --no-audit

COPY . .

EXPOSE 3000

CMD ["node", "main.js"]
