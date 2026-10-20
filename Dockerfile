FROM node:24.20.0-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
CMD ["npm", "test"]
