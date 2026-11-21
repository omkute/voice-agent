package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/example/voice-agent/services/orchestrator/internal/session"
)

func main() {
	store := session.NewStore()
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /v1/sessions/{id}", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusCreated, store.Open(r.PathValue("id")))
	})
	mux.HandleFunc("GET /v1/sessions/{id}", func(w http.ResponseWriter, r *http.Request) {
		state, ok := store.Get(r.PathValue("id"))
		if !ok {
			writeError(w, http.StatusNotFound, "session not found")
			return
		}
		writeJSON(w, http.StatusOK, state)
	})
	mux.HandleFunc("POST /v1/sessions/{id}/events", func(w http.ResponseWriter, r *http.Request) {
		var event session.Event
		if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
			writeError(w, http.StatusBadRequest, "invalid event body")
			return
		}
		state, actions, err := store.Apply(r.PathValue("id"), event)
		if err != nil {
			status := http.StatusConflict
			if strings.Contains(err.Error(), "not found") {
				status = http.StatusNotFound
			}
			writeError(w, status, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"session": state, "actions": actions})
	})

	port := os.Getenv("ORCHESTRATOR_PORT")
	if port == "" {
		port = "8081"
	}
	slog.Info("orchestrator listening", "port", port)
	if err := http.ListenAndServe(":"+port, logging(mux)); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		slog.Info("request", "method", r.Method, "path", r.URL.Path)
		next.ServeHTTP(w, r)
	})
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
