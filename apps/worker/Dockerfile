FROM node:20-alpine
# ca-certificates: required for Node fetch() to verify HTTPS endpoints.
# Without it, every adapter call to https://*.glean.com fails with
# UNABLE_TO_GET_ISSUER_CERT_LOCALLY. node:20-alpine does NOT ship the
# system trust store by default.
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.base.json ./
RUN npm install --no-audit --no-fund
WORKDIR /app
CMD ["npm", "--workspace", "apps/worker", "run", "start"]
