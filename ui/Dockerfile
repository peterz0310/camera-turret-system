FROM node:18-bullseye

# Set working directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy the app (will be overridden in dev by volume)
COPY . .

# Start dev server
CMD ["npm", "start"]
