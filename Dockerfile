FROM rust:1.97-alpine
ENV TZ="Europe/Budapest"
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
CMD ["sh", "-c", "cargo build --release && exec ./target/release/vbot"]
