// A set of structures to manage swarms, like joining, removing etc.
// Typically this is a many to many relationship, but I am only using a one to many relationship:
// everytime a swarm is requested, we clean it by removing inactive peers and then send it, instead of
// removing a peer from each swarm everytime the disconnect. This greatly simplifies code

package main

import (
	"errors"
	"fmt"
	"sync"
)

type swarm struct {
	mutex sync.Mutex
	peers map[string]struct{}
}

func newSwarm() *swarm {
	return &swarm{peers: make(map[string]struct{})}
}

func (s *swarm) add(peerID string) {
	s.mutex.Lock()
	s.peers[peerID] = struct{}{}
	s.mutex.Unlock()
}

func (s *swarm) remove(peerID string) {
	s.mutex.Lock()
	delete(s.peers, peerID)
	s.mutex.Unlock()
}

// we need peers that are online so we can clean them up as we go
func (s *swarm) getAll(peersOnline map[string]*websocketRWLock) []string {
	ret := make([]string, 0, len(s.peers))
	for p := range s.peers {
		_, ok := peersOnline[p]
		if ok {
			ret = append(ret, p)
		} else {
			// this is safe!
			s.remove(p)
		}
	}
	return ret
}

// use case #2 for sync.Map accoring to docs: "when multiple goroutines read, write, and overwrite entries for disjoint sets of keys"
// this matches that use case (many different swarms)
type swarmManager struct {
	fileToPeers sync.Map
}

func (s *swarmManager) joinSwarm(peerID string, fileID string) error {
	tmp, _ := s.fileToPeers.LoadOrStore(fileID, newSwarm())
	swarm, ok := tmp.(*swarm)
	if !ok {
		return errors.New("unknown data type in piece->peers relational map")
	}
	swarm.add(peerID)
	return nil
}

func (s *swarmManager) leaveSwarm(peerID string, fileID string) error {
	tmp, ok := s.fileToPeers.Load(fileID)
	if !ok {
		e := fmt.Sprintf("Peer %s trying to leave bogus swarm with fileID %s", peerID, fileID)
		return errors.New(e)
	}
	swarm, ok := tmp.(*swarm)
	if !ok {
		return errors.New("unknown data type in piece->peers relational map")
	}
	swarm.remove(peerID)
	return nil
}

func (s *swarmManager) getSwarm(fileID string, peersOnline map[string]*websocketRWLock) ([]string, error) {
	tmp, ok := s.fileToPeers.Load(fileID)
	if !ok {
		e := fmt.Sprint("No swarm with fileID", fileID)
		return nil, errors.New(e)
	}
	swarm, ok := tmp.(*swarm)
	if !ok {
		return nil, errors.New("unknown data type in swarms ")
	}
	return swarm.getAll(peersOnline), nil
}
