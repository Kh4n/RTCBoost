// The boost server. A websocket handler basically. Designed to be a bare minimum as possible so that it
// can handle many connections simultaneously without needing to store large ammounts of info

package main

import (
	"encoding/json"
	"errors"
	"flag"
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

// the actual server struct
type server struct {
	upgrader *websocket.Upgrader

	// keep track of peer connections so we can signal. no need for sync.map, this does not fit use case
	peers     map[string]*websocketRWLock
	peersLock sync.Mutex

	sm swarmManager
}

// make a new server
func newServer() *server {
	upgrader := websocket.Upgrader{}
	upgrader.CheckOrigin = func(r *http.Request) bool { return true }
	return &server{
		upgrader: &upgrader,
		peers:    make(map[string]*websocketRWLock),
	}
}

// write JSON to a peer, locking properly and everything
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

// handles a connection from a peer
func (s *server) handleConnection(w http.ResponseWriter, r *http.Request) {
	c, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Unable to upgrade:", err)
		return
	}
	log.Println("Received new connection from:", c.RemoteAddr().String())

	// each peer gets a unique ID
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

		// we only deal with text messages
		case websocket.TextMessage:
			err = s.handleText(c, uid, msg)
			if err != nil {
				log.Println("Error occurred while reading text message:", err)
			}
		case websocket.BinaryMessage:
			log.Println("Binary message received:", msg)
		}
	}
}

// uses a closure to automatically handle cleanup
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

// handle a text connection. returns any errors received without terminating connection
func (s *server) handleText(c *websocket.Conn, uid string, msg []byte) error {
	// I have found this to be the best way to deal with JSON in go (there are others)
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
		e := fmt.Sprint("unknown data received: ", a)
		err = errors.New(e)
	}

	return err
}

func (s *server) handleJoin(c *websocket.Conn, uid string, msg []byte) error {
	n, err := readJoin(msg)
	if err != nil {
		return err
	}

	// try to join an existing swarm or make a new one
	err = s.sm.joinSwarm(uid, n.FileID)
	if err != nil {
		return err
	}

	// will return the peers own peerID along with list of other peers in swarm (including them)
	// it is up to the peer to not connect to itself
	peers, err := s.sm.getSwarm(n.FileID, s.peers)
	if err != nil {
		return err
	}
	nr := makeJoinResponse(uid, peers)

	tmp, ok := s.peers[uid]
	if !ok {
		e := fmt.Sprint("Peer has disconnected, not sending join info. PeerID:", uid)
		return errors.New(e)

	}
	// only need to lock the actual connection, not entire map.
	// if map changes it is not an issue becuase we are only holding pointer (read is safe)
	lock := &tmp.mutex
	lock.Lock()
	c.WriteJSON(nr)
	lock.Unlock()
	return nil
}

func (s *server) handleForward(msg []byte) error {
	f, err := readForward(msg)
	if err != nil {
		return err
	}
	return s.writeJSONToPeer(f, f.To)
}

func main() {
	portNum := flag.Uint("port", 6503, "the port to use")
	flag.Parse()
	port := fmt.Sprintf(":%d", *portNum)

	s := newServer()
	http.HandleFunc("/", s.handleConnection)
	log.Println("Starting server on port", port)
	log.Fatal(http.ListenAndServe(port, nil))
}
