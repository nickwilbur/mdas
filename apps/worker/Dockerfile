FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.base.json ./
RUN npm install --no-audit --no-fund
WORKDIR /app
CMD ["npm", "--workspace", "apps/worker", "run", "start"]
