# Build golang binary
FROM golang:1.18-buster AS gobuild
WORKDIR /app
COPY go.mod ./
COPY go.sum ./
RUN go mod download

COPY server.go ./
RUN go build -o /server

# Deploy
FROM gcr.io/distroless/base-debian10
WORKDIR /app
COPY client.html ./
COPY client.js ./
COPY key.pem ./
COPY cert.pem ./
COPY --from=gobuild /server ./server

ENTRYPOINT ["/app/server"]
