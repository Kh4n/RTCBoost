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

type files struct {
	inner sync.Map
}

func (f *files) add(fname string, pieceID string) error {
	tmp, _ := f.inner.LoadOrStore(fname, make(map[string]struct{}))
	pieces, ok := tmp.(map[string]struct{})
	if !ok {
		return errors.New("unknown datatype in files struct")
	}
	pieces[pieceID] = struct{}{}
	return nil
}

func (f *files) get(fname string) map[string]struct{} {
	tmp, _ := f.inner.LoadOrStore(fname, make(map[string]struct{}))
	pieces, _ := tmp.(map[string]struct{})
	return pieces
}

type server struct {
	upgrader  *websocket.Upgrader
	peers     map[string]*websocketRWLock
	peersLock sync.Mutex

	sm   swarmManager
	info files
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
	s.peersLock.Lock()
	defer s.peersLock.Unlock()
	s.peers[uid] = &websocketRWLock{conn: c}
	c.SetCloseHandler(func(code int, text string) error {
		s.peersLock.Lock()
		defer s.peersLock.Unlock()
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
		err = s.handleForward(msg)
	case "join":
		err = s.handleJoin(c, uid, msg)

	default:
		e := fmt.Sprint("unknown data recieved: ", a)
		err = errors.New(e)
	}

	return err
}

func (s *server) handleJoin(c *websocket.Conn, uid string, msg []byte) error {
	n, err := readJoin(msg)
	if err != nil {
		return err
	}
	peers, err := s.sm.getSwarm(n.FileID, s.peers)
	if err != nil {
		return err
	}
	nr := makeJoinResponse(uid, peers)
	return c.WriteJSON(nr)
}

func (s *server) handleForward(msg []byte) error {
	f, err := readForward(msg)
	if err != nil {
		return err
	}
	return s.writeJSONToPeer(f, f.To)
}

func main() {
	s := newServer()
	http.HandleFunc("/", s.handleConnection)
	log.Println("Starting server")
	log.Fatal(http.ListenAndServe("localhost:6503", nil))
}
