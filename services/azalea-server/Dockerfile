# syntax=docker/dockerfile:1

FROM rust:1.88-bookworm AS build
WORKDIR /app

# Cache deps when only source changes
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main(){}' > src/main.rs \
  && cargo build --release \
  && rm -rf src

COPY src ./src
COPY migrations ./migrations
RUN touch src/main.rs && cargo build --release

FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --home /data --create-home --uid 999 azalea
WORKDIR /data
COPY --from=build /app/target/release/azalea-server /usr/local/bin/azalea-server
USER azalea
ENV AZALEA_DATA_DIR=/data
ENV AZALEA_BIND=0.0.0.0:8787
VOLUME ["/data"]
EXPOSE 8787
CMD ["azalea-server", "serve"]
