package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/segmentio/ksuid"
)

type websocketRWLock struct {
	conn  *websocket.Conn
	mutex sync.Mutex
}

type server struct {
	upgrader *websocket.Upgrader
	peers    map[string]*websocketRWLock

	pp   peersToPieces
	info map[string]map[string]struct{}
}

func newServer() *server {
	upgrader := websocket.Upgrader{}
	upgrader.CheckOrigin = func(r *http.Request) bool { return true }
	return &server{
		upgrader: &upgrader,
		peers:    make(map[string]*websocketRWLock),
	}
}

func (s *server) writeJSONToPeer(dat interface{}, peerID string) error {
	if _, ok := s.peers[peerID]; !ok {
		return errors.New("Peer attempting to connect to peerID that does not exist")
	}
	s.peers[peerID].mutex.Lock()
	defer s.peers[peerID].mutex.Unlock()
	err := s.peers[peerID].conn.WriteJSON(dat)
	if err != nil {
		return err
	}
	return nil
}

func (s *server) handleConnection(w http.ResponseWriter, r *http.Request) {
	c, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Unable to upgrade:", err)
		return
	}
	log.Println("Recieved new connection from:", c.RemoteAddr().String())
	uid := s.registerPeer(c)

	defer c.Close()
	for {
		mt, msg, err := c.ReadMessage()
		if err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				return
			}
			log.Println("Error reading message:", err)
			return
		}
		switch mt {
		case websocket.TextMessage:
			err = s.handleText(c, uid, msg)
			if err != nil {
				log.Println("Error occurred while reading text message:", err)
			}
		case websocket.BinaryMessage:
			log.Println("Binary message recieved:", msg)
		}
	}
}

func (s *server) registerPeer(c *websocket.Conn) string {
	uid := ksuid.New().String()
	s.peers[uid] = &websocketRWLock{conn: c}
	c.SetCloseHandler(func(code int, text string) error {
		s.pp.peerRemoveAll(uid)
		delete(s.peers, uid)
		log.Println("Removed peer:", uid)
		return s.handleClose(code, text)
	})
	return uid
}

func (s *server) handleClose(code int, text string) error {
	log.Println("Connection closed:", code, ":", text)
	return nil
}

func (s *server) handleText(c *websocket.Conn, uid string, msg []byte) error {
	var a all
	err := json.Unmarshal(msg, &a)
	if err != nil {
		return err
	}

	log.Println("Type:", a.Type)
	switch a.Type {
	case "forward":
		err = s.handleForward(uid, msg)
	case "offer", "answer":
		err = s.handleOfferOrAnswer(uid, msg)

	case "info":
		err = s.handleInfo(c, msg)
	case "action":
		err = s.handleAction(msg)
	case "need":
		err = s.handleNeed(c, msg)

	default:
		e := fmt.Sprint("unknown data recieved: ", a)
		err = errors.New(e)
	}

	return err
}

func (s *server) handleNeed(c *websocket.Conn, msg []byte) error {
	n, err := readNeed(msg)
	if err != nil {
		return err
	}
	nr := makeNeedResponse(s.pp.getPeersForPiece(n.PieceID))
	return c.WriteJSON(nr)
}

func (s *server) handleAction(msg []byte) error {
	a, err := readAction(msg)
	if err != nil {
		return err
	}
	if a.Action == "add" {
		s.info[a.Name][a.PieceID] = struct{}{}
		err = s.pp.peerHas(a.PeerID, a.PieceID)
	} else {
		err = s.pp.peerRemove(a.PeerID, a.PieceID)
	}
	if err != nil {
		return err
	}
	return nil
}

func (s *server) handleInfo(c *websocket.Conn, msg []byte) error {
	inf, err := readInfo(msg)
	if err != nil {
		return err
	}

	pieces := s.info[inf.Name]
	pieceList := make([]string, 0, len(pieces))
	for p := range pieces {
		pieceList = append(pieceList, p)
	}
	resp := makeInfoResponse(pieceList)
	return c.WriteJSON(resp)
}

func (s *server) handleOfferOrAnswer(uid string, msg []byte) error {
	oa, err := readOfferOrAnswer(msg)
	if err != nil {
		return err
	}
	oa.From = uid
	return s.writeJSONToPeer(oa, oa.To)
}

func (s *server) handleForward(uid string, msg []byte) error {
	f, err := readForward(msg)
	if err != nil {
		return err
	}
	f.From = uid
	return s.writeJSONToPeer(f, f.To)
}

func main() {
	s := newServer()
	http.HandleFunc("/", s.handleConnection)
	log.Println("Starting server")
	log.Fatal(http.ListenAndServe("localhost:6503", nil))
}
