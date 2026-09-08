# syntax=docker/dockerfile:1

FROM rust:1.85-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
COPY src ./src
COPY migrations ./migrations
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/target/release/azalea-server /usr/local/bin/azalea-server
ENV AZALEA_DATA_DIR=/data
ENV AZALEA_BIND=0.0.0.0:8787
VOLUME ["/data"]
EXPOSE 8787
CMD ["azalea-server"]
