FROM golang:1.24-alpine AS build
WORKDIR /src
COPY services/orchestrator/go.mod ./
COPY services/orchestrator/ .
RUN CGO_ENABLED=0 go build -o /orchestrator ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /orchestrator /orchestrator
EXPOSE 8081
ENTRYPOINT ["/orchestrator"]

