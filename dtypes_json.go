package main

import (
	"encoding/json"
	"errors"
)

type all struct {
	Type string `json:"type"`
}

type offerOrAnswer struct {
	Type       string `json:"type"`
	From       string `json:"from"`
	To         string `json:"to"`
	PeerConnID string `json:"peerConnID"`
	SDP        string `json:"sdp"`
	PieceID    string `json:"pieceID"`
}

type forward struct {
	Type       string `json:"type"`
	From       string `json:"from"`
	To         string `json:"to"`
	PeerConnID string `json:"peerConnID"`
	Data       string `json:"data"`
}

type info struct {
	Type string `json:"type"`
	Name string `json:"name"`
}
type infoResponse struct {
	Type      string   `json:"type"`
	PieceList []string `json:"pieceList"`
}

type action struct {
	Type    string `json:"type"`
	PeerID  string `json:"peerID"`
	Name    string `json:"name"`
	PieceID string `json:"pieceID"`
	Action  string `json:"action"`
}

type need struct {
	Type    string `json:"type"`
	PieceID string `json:"pieceID"`
}
type needResponse struct {
	Type     string   `json:"type"`
	PeerList []string `json:"peerList"`
}

func readOfferOrAnswer(peerID string, msg []byte) (*offerOrAnswer, error) {
	var t offerOrAnswer
	err := json.Unmarshal(msg, &t)
	if err != nil {
		return nil, err
	}

	t.From = peerID
	err = t.Check()
	if err != nil {
		return nil, err
	}

	return &t, nil
}

func (m *offerOrAnswer) Check() error {
	if m.From == "" {
		errors.New("no From field in JSON with type offerOrAnswer")
	}
	if m.To == "" {
		return errors.New("no To field in JSON with type offerOrAnswer")
	}
	if m.PeerConnID == "" {
		return errors.New("no PeerConnID field in JSON with type offerOrAnswer")
	}
	if m.SDP == "" {
		return errors.New("no SDP field in JSON with type offerOrAnswer")
	}
	if m.PieceID == "" && m.Type == "offer" {
		return errors.New("no PieceID field in JSON with type offer")
	}
	return nil
}

func readForward(peerID string, msg []byte) (*forward, error) {
	var t forward
	err := json.Unmarshal(msg, &t)
	if err != nil {
		return nil, err
	}

	t.From = peerID
	err = t.Check()
	if err != nil {
		return nil, err
	}

	return &t, nil
}

func (m *forward) Check() error {
	if m.From == "" {
		errors.New("no From field in JSON with type forward")
	}
	if m.To == "" {
		return errors.New("no To field in JSON with type forward")
	}
	if m.PeerConnID == "" {
		return errors.New("no PeerConnID field in JSON with type forward")
	}
	if m.Data == "" {
		return errors.New("no Data field in JSON with type forward")
	}
	return nil
}

func readInfo(msg []byte) (*info, error) {
	var t info
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

func (m *info) Check() error {
	if m.Name == "" {
		return errors.New("no Name field in JSON with type info")
	}
	return nil
}

func makeInfoResponse(plist []string) *infoResponse {
	return &infoResponse{
		Type:      "infoResponse",
		PieceList: plist,
	}
}

func readAction(peerID string, msg []byte) (*action, error) {
	var t action
	err := json.Unmarshal(msg, &t)
	if err != nil {
		return nil, err
	}

	t.PeerID = peerID
	err = t.Check()
	if err != nil {
		return nil, err
	}

	return &t, nil
}

func (m *action) Check() error {
	if m.PeerID == "" {
		return errors.New("no PeerID field in JSON with type action")
	}
	if m.Name == "" {
		return errors.New("no Name field in JSON with type action")
	}
	if m.PieceID == "" {
		return errors.New("no PieceID field in JSON with type action")
	}
	if m.Action != "add" && m.Action != "remove" {
		return errors.New("Action field in JSON with type action is not either 'add' or 'remove'")
	}
	return nil
}

func readNeed(msg []byte) (*need, error) {
	var t need
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

func (m *need) Check() error {
	if m.PieceID == "" {
		return errors.New("no PieceID field in JSON with type need")
	}
	return nil
}

func makeNeedResponse(plist []string) *needResponse {
	return &needResponse{
		Type:     "needResponse",
		PeerList: plist,
	}
}
