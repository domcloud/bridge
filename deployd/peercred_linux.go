//go:build linux

package main

import (
	"net"
	"syscall"
)

type Credentials struct {
	Uid uint32
	Gid uint32
	Pid int32
}

func getPeerCred(conn *net.UnixConn) (*Credentials, error) {
	file, err := conn.File()
	if err != nil {
		return nil, err
	}
	defer file.Close()

	ucred, err := syscall.GetsockoptUcred(int(file.Fd()), syscall.SOL_SOCKET, syscall.SO_PEERCRED)
	if err != nil {
		return nil, err
	}

	return &Credentials{
		Uid: ucred.Uid,
		Gid: ucred.Gid,
		Pid: ucred.Pid,
	}, nil
}
