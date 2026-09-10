# azalea-web (self-host front)

Static Next export served by Nginx in Docker. Proxies `/api/` to
`azalea-server`. Used by the self-host installer when you opt into the web front.

Published image: `ghcr.io/rexsystems/azalea-web:latest`

Public product site (landing / download / `script.sh`): separate repo
`rexsystems/azalea-web` at https://azalea.rexsystems.me

## Local

```bash
cd apps/azalea-web && npm install && npm run build
```

## Docker

```bash
docker build -t azalea-web:local \
  --build-arg NEXT_PUBLIC_AZALEA_API_URL=/api \
  .
```
