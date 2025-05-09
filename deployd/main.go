package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
)

func main() {
	// # Step 1
	// Set up a unix domain socket, a special file on disk over which a server
	// and clients can communicate.
	socketFile := os.Getenv("SOCKET_PATH")
	if socketFile == "" {
		socketFile = "/run/bridge/deployd.sock"
	}
	os.Remove(socketFile)
	listener, _ := net.Listen("unix", socketFile)

	targetPort := os.Getenv("PORT")
	if targetPort == "" {
		targetPort = "2223"
	}

	secret := os.Getenv("SECRET")
	if secret == "" {
		panic("SECRET env is required")
	}

	// Context key for credentials we will obtain from incoming connections.
	var credentialsContextKey = struct{}{}

	// # Step 2
	// Create the HTTP server
	server := &http.Server{
		// `ConnContext` allows us to inspect the incoming client connection
		// and modify the `Context` which is subsequently made available to all
		// HTTP handlers on the server for this connection.
		ConnContext: func(ctx context.Context, c net.Conn) context.Context {
			conn, ok := c.(*net.UnixConn)
			if !ok {
				return ctx
			}
			credentials, err := getPeerCred(conn)
			if err != nil {
				return ctx
			}
			return context.WithValue(ctx, credentialsContextKey, credentials)
		},
	}

	// # Step 3
	// Attach a simple HTTP handler where we can make use of the incoming
	// connection's credentials.
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Retrieve the credentials from the request context
		credentials := r.Context().Value(credentialsContextKey).(*Credentials)

		// Send to target port
		// 1. create a new http client
		client := &http.Client{}
		// 2. create a new request
		uri := fmt.Sprintf("http://127.0.0.1:%s/runner/from-unix?sandbox=1&user=%d", targetPort, credentials.Uid)
		req, _ := http.NewRequest("POST", uri, r.Body)
		// 3. copy headers
		req.Header.Add("authorization", "Bearer "+secret)
		// 4. send the request
		resp, _ := client.Do(req)
		w.Header().Add("Content-Type", "text/plain")
		w.Header().Add("Transfer-Encoding", " chunked")
		if resp != nil {
			defer resp.Body.Close()
			io.Copy(w, resp.Body)
		}
	})

	// Note: the above can be abstracted into middleware that chooses to
	// enforce security conditions.

	// Start the HTTP server
	server.Serve(listener)
}
