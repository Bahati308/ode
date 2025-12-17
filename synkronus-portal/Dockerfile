# Multi-stage build for Synkronus Portal
# Stage 1: Build the React application
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom nginx configuration for SPA routing
# Use resolver with variables to resolve upstream at request time (not startup)
RUN echo 'server { \
    listen 0.0.0.0:80; \
    listen [::]:80; \
    server_name _; \
    root /usr/share/nginx/html; \
    index index.html; \
    # Resolver for dynamic upstream resolution \
    resolver 127.0.0.11 8.8.8.8 1.1.1.1 valid=30s ipv6=off; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
    # Proxy API requests to backend \
    location /api { \
        rewrite ^/api(.*)$ $1 break; \
        # Use variable for proxy_pass to enable runtime DNS resolution \
        set $backend "http://demo.synkronus.cloud"; \
        proxy_pass $backend; \
        proxy_http_version 1.1; \
        proxy_set_header Upgrade $http_upgrade; \
        proxy_set_header Connection "upgrade"; \
        proxy_set_header Host $host; \
        proxy_set_header X-Real-IP $remote_addr; \
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; \
        proxy_set_header X-Forwarded-Proto $scheme; \
        client_max_body_size 100M; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]


