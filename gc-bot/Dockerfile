FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY index.js ./
# Refresh-token storage — mount a volume here so logins survive restarts.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
ENV DATA_DIR=/data PORT=7300
EXPOSE 7300
USER node
CMD ["node", "index.js"]
