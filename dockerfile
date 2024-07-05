
FROM node:16 AS builder

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY . .

RUN npm install
RUN npm run build

# Use a lightweight Node.js runtime as the base image for the final Docker image
FROM node:16

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install only production dependencies
RUN npm ci

# Copy the built JavaScript code from the builder stage to the container
COPY --from=builder /app/dist ./dist

# Expose the port on which the application will run
EXPOSE 3000

# Start the application
CMD [ "node", "dist/index.js",  "--topology", "/app/config/topology.json", "--protocolConfig", "/app/config/protocolConfig.json" ,"--notificationConfig", "/app/config/notificationConfig.json" ,"--secrets", "/app/config/secrets.json", "--bitcoinConfig", "/app/config/bitcoinConfig.json", "--cardanoConfig", "/app/config/cardanoConfig.json" ]
