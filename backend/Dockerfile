# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM rust:1.78-slim as builder

WORKDIR /app

# Install system deps for reqwest TLS and html2text
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock* ./
# Build dependencies only first for layer caching
RUN mkdir src && echo 'fn main(){}' > src/main.rs && echo 'fn main(){}' > src/evals.rs
RUN cargo build --release 2>/dev/null || true
RUN rm -rf src

COPY src ./src
RUN cargo build --release

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM debian:bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/bs-detector ./bs-detector

# Documents are mounted at runtime via docker-compose volume
EXPOSE 8002

CMD ["./bs-detector"]
