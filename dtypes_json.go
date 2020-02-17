package main

import (
	"encoding/json"
	"errors"
	"fmt"
)

// base json
type all struct {
	Type string `json:"type"`
}

type forward struct {
	Type string `json:"type"`
	From string `json:"from"`
	To   string `json:"to"`
	Data string `json:"data"`
}

type join struct {
	Type   string `json:"type"`
	FileID string `json:"fileID"`
}
type joinResponse struct {
	Type     string   `json:"type"`
	PeerID   string   `json:"peerID"`
	PeerList []string `json:"peerList"`
}

func readForward(msg []byte) (*forward, error) {
	var t forward
	err := json.Unmarshal(msg, &t)
	if err != nil {
		return nil, err
	}

	err = t.Check()
	if err != nil {
		return nil, err
	}

	return &t, nil
}

func (m *forward) Check() error {
	if m.From == "" {
		return errors.New("no From field in JSON with type forward")
	}
	if m.To == "" {
		return errors.New("no To field in JSON with type forward")
	}
	if m.Data == "" {
		return errors.New("no Data field in JSON with type forward")
	}
	// peer will also check for this
	if m.From == m.To {
		e := fmt.Sprint("Peers cannot forward to themselves:", m.From)
		return errors.New(e)
	}
	return nil
}

func readJoin(msg []byte) (*join, error) {
	var t join
	err := json.Unmarshal(msg, &t)
	if err != nil {
		return nil, err
	}

	err = t.Check()
	if err != nil {
		return nil, err
	}

	return &t, nil
}

func (m *join) Check() error {
	if m.FileID == "" {
		return errors.New("no FileID field in JSON with type join")
	}
	return nil
}

func makeJoinResponse(peerID string, plist []string) *joinResponse {
	return &joinResponse{
		Type:     "joinResponse",
		PeerID:   peerID,
		PeerList: plist,
	}
}
