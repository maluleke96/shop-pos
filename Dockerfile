# Shop POS — Railway web image (UI + /rpc). No Electron. No npm run build.
FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV SHOP_POS_CLOUD=1

EXPOSE 3000

# Never run electron-builder. Start the web RPC server only.
CMD ["node", "server.js"]
