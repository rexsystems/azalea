# syntax=docker/dockerfile:1

FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
# Browser calls same-origin /api (nginx proxies to azalea-server).
ARG NEXT_PUBLIC_AZALEA_API_URL=/api
ARG NEXT_PUBLIC_SITE_URL=
ENV NEXT_PUBLIC_AZALEA_API_URL=$NEXT_PUBLIC_AZALEA_API_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/out /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
