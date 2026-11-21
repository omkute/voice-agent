package session

import "testing"

func TestConversationLifecycle(t *testing.T) {
	store := NewStore()
	got := store.Open("session-1")
	if got.Phase != Listening {
		t.Fatalf("open phase = %q, want listening", got.Phase)
	}

	got, actions, err := store.Apply("session-1", Event{
		ID: "event-1", Kind: TranscriptFinal, TurnID: "turn-1", Text: "hello",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.Phase != Thinking || len(actions) != 2 {
		t.Fatalf("after transcript: phase=%q actions=%v", got.Phase, actions)
	}

	got, _, err = store.Apply("session-1", Event{ID: "event-2", Kind: ResponseStarted})
	if err != nil || got.Phase != Speaking {
		t.Fatalf("after response start: phase=%q err=%v", got.Phase, err)
	}

	got, actions, err = store.Apply("session-1", Event{ID: "event-3", Kind: SpeechStarted})
	if err != nil || got.Phase != Interrupted || actions[0].Kind != "cancel_response" {
		t.Fatalf("after barge-in: phase=%q actions=%v err=%v", got.Phase, actions, err)
	}
}

func TestDuplicateEventIsIgnored(t *testing.T) {
	store := NewStore()
	store.Open("session-1")
	event := Event{ID: "same", Kind: TranscriptFinal, TurnID: "turn-1", Text: "hello"}
	first, _, _ := store.Apply("session-1", event)
	second, actions, err := store.Apply("session-1", event)
	if err != nil || second.Version != first.Version || len(actions) != 0 {
		t.Fatalf("duplicate mutated session: first=%v second=%v actions=%v err=%v", first, second, actions, err)
	}
}
