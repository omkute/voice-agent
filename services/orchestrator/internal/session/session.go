package session

import (
	"errors"
	"fmt"
	"sync"
)

type Phase string

const (
	Listening   Phase = "listening"
	Thinking    Phase = "thinking"
	Speaking    Phase = "speaking"
	Interrupted Phase = "interrupted"
	Ended       Phase = "ended"
)

type EventKind string

const (
	SpeechStarted    EventKind = "speech_started"
	TranscriptFinal  EventKind = "transcript_final"
	ResponseStarted  EventKind = "response_started"
	ResponseFinished EventKind = "response_finished"
	Interrupt        EventKind = "interrupted"
	SessionEnded     EventKind = "session_ended"
)

type Event struct {
	ID     string    `json:"eventId"`
	Kind   EventKind `json:"kind"`
	Text   string    `json:"text,omitempty"`
	TurnID string    `json:"turnId,omitempty"`
}

type Action struct {
	Kind   string `json:"kind"`
	TurnID string `json:"turnId,omitempty"`
	Text   string `json:"text,omitempty"`
}

type Snapshot struct {
	ID           string `json:"sessionId"`
	Phase        Phase  `json:"phase"`
	Version      uint64 `json:"version"`
	ActiveTurnID string `json:"activeTurnId,omitempty"`
}

type aggregate struct {
	Snapshot
	seen map[string]struct{}
}

// Store is the session module's interface. Apply provides atomic, idempotent
// transitions; callers never need to coordinate reads and writes themselves.
type Store struct {
	mu       sync.Mutex
	sessions map[string]*aggregate
}

func NewStore() *Store {
	return &Store{sessions: make(map[string]*aggregate)}
}

func (s *Store) Open(id string) Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()

	if current, ok := s.sessions[id]; ok {
		return current.Snapshot
	}
	created := &aggregate{
		Snapshot: Snapshot{ID: id, Phase: Listening, Version: 1},
		seen:     make(map[string]struct{}),
	}
	s.sessions[id] = created
	return created.Snapshot
}

func (s *Store) Get(id string) (Snapshot, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	current, ok := s.sessions[id]
	if !ok {
		return Snapshot{}, false
	}
	return current.Snapshot, true
}

func (s *Store) Apply(id string, event Event) (Snapshot, []Action, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	current, ok := s.sessions[id]
	if !ok {
		return Snapshot{}, nil, errors.New("session not found")
	}
	if _, duplicate := current.seen[event.ID]; duplicate {
		return current.Snapshot, nil, nil
	}
	if current.Phase == Ended {
		return current.Snapshot, nil, errors.New("session has ended")
	}

	actions, err := transition(&current.Snapshot, event)
	if err != nil {
		return current.Snapshot, nil, err
	}
	current.seen[event.ID] = struct{}{}
	current.Version++
	return current.Snapshot, actions, nil
}

func transition(state *Snapshot, event Event) ([]Action, error) {
	switch event.Kind {
	case SpeechStarted:
		if state.Phase == Speaking || state.Phase == Thinking {
			state.Phase = Interrupted
			return []Action{{Kind: "cancel_response", TurnID: state.ActiveTurnID}}, nil
		}
		state.Phase = Listening
		return nil, nil
	case TranscriptFinal:
		if event.Text == "" || event.TurnID == "" {
			return nil, errors.New("final transcript requires text and turnId")
		}
		state.Phase = Thinking
		state.ActiveTurnID = event.TurnID
		return []Action{
			{Kind: "persist_transcript", TurnID: event.TurnID, Text: event.Text},
			{Kind: "request_response", TurnID: event.TurnID, Text: event.Text},
		}, nil
	case ResponseStarted:
		if state.Phase != Thinking {
			return nil, fmt.Errorf("cannot start response while %s", state.Phase)
		}
		state.Phase = Speaking
		return nil, nil
	case ResponseFinished:
		if state.Phase != Speaking {
			return nil, fmt.Errorf("cannot finish response while %s", state.Phase)
		}
		state.Phase = Listening
		state.ActiveTurnID = ""
		return nil, nil
	case Interrupt:
		state.Phase = Interrupted
		return []Action{{Kind: "cancel_response", TurnID: state.ActiveTurnID}}, nil
	case SessionEnded:
		state.Phase = Ended
		return []Action{{Kind: "enqueue_post_call"}}, nil
	default:
		return nil, fmt.Errorf("unsupported event kind %q", event.Kind)
	}
}
