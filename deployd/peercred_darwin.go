//go:build darwin

package main

import (
	"errors"
	"net"
	"os"
	"syscall"
	"unsafe"
)

const (
	SOL_LOCAL      = 0 // Local communication
	LOCAL_PEERCRED = 1 // Option for getsockopt
	XUCRED_VERSION = 0 // Expected xucred version
	MAX_GROUPS     = 16
)

type xucred struct {
	Version uint32
	Uid     uint32
	Ngroups int16
	Groups  [MAX_GROUPS]uint32
}

type Credentials struct {
	Uid uint32
	Gid uint32
	Pid int32 // Not available on macOS
}

func getPeerCred(conn *net.UnixConn) (*Credentials, error) {
	file, err := conn.File()
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var cred xucred
	var size = uint32(unsafe.Sizeof(cred))

	_, _, errno := syscall.Syscall6(
		syscall.SYS_GETSOCKOPT,
		file.Fd(),
		uintptr(SOL_LOCAL),
		uintptr(LOCAL_PEERCRED),
		uintptr(unsafe.Pointer(&cred)),
		uintptr(unsafe.Pointer(&size)),
		0,
	)

	if errno != 0 {
		return nil, os.NewSyscallError("getsockopt", errno)
	}
	if cred.Version != XUCRED_VERSION {
		return nil, errors.New("unexpected xucred version")
	}

	return &Credentials{
		Uid: cred.Uid,
		Gid: cred.Groups[0],
		Pid: -1,
	}, nil
}
