# Multi-stage build for wikifarm recorder service
FROM rust:bullseye AS build
WORKDIR /build
# Cache deps
COPY services/recorder/docker/Cargo.workspace.toml Cargo.toml

# Pre-build deps (create minimal workspace to cache dependencies)
RUN mkdir -p service/src && echo 'fn main() {}' > service/src/main.rs
COPY services/recorder/Cargo.toml service/Cargo.toml
RUN cargo build --release -p wikifarm-service

# Real source
COPY services/recorder/src service/src
RUN cargo build --release -p wikifarm-service

FROM debian:stable-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl rsync php-cli && \
    rm -rf /var/lib/apt/lists/*

# Add a non-root user
WORKDIR /app
COPY --from=build /build/target/release/wikifarm-service /usr/local/bin/wikifarm-service

RUN rm -rf /build

EXPOSE 8080
ENV RUST_LOG=info
ENTRYPOINT ["wikifarm-service"]
