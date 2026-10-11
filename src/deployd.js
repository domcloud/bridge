import http from 'http';
import { existsSync, unlinkSync, chmodSync, mkdirSync } from 'fs';
import peercred from 'peercred';
import { dirname } from 'path';

export const initDeployd = function () {
    const socketFile = process.env.SOCKET_PATH || '/run/bridge/deployd.sock';
    const targetPort = process.env.PORT || '2223';
    const secret = process.env.SECRET;

    if (!secret) {
        return;
    }

    if (existsSync(socketFile)) {
        unlinkSync(socketFile);
    }
    const socketDir = dirname(socketFile);
    if (!existsSync(socketDir)) {
        mkdirSync(socketDir);
    }

    const server = http.createServer((req, res) => {
        try {
            const creds = peercred.fromSock(req.socket);

            /**
             * @type {Uint8Array<ArrayBufferLike>[]}
             */
            let body = [];
            req.on('data', chunk => body.push(chunk));
            req.on('end', () => {
                const bodyData = Buffer.concat(body);

                // creds returns { uid, gid, pid }
                const uri = `http://127.0.0.1:${targetPort}/runner/from-unix?sandbox=1&user=${creds.uid}`;

                const proxyReq = http.request(uri, {
                    method: req.method || 'POST',
                    headers: {
                        'authorization': 'Bearer ' + secret,
                        'content-length': bodyData.length,
                        'content-type': req.headers['content-type'] || 'text/plain'
                    }
                }, (proxyRes) => {
                    res.writeHead(200, {
                        'Content-Type': 'text/plain',
                        'Transfer-Encoding': 'chunked'
                    });

                    res.write(bodyData);
                    res.write('\n');
                    proxyRes.pipe(res);
                });

                proxyReq.on('error', (err) => {
                    res.writeHead(502);
                    res.end(`Proxy Error: ${err.message}`);
                });

                proxyReq.write(bodyData);
                proxyReq.end();
            });

        } catch (err) {
            res.writeHead(500);
            res.end(`Failed to process socket credentials: ${err?.message}`);
        }
    });

    server.listen(socketFile, () => {
        console.log(`deployd listening directly on Node via ${socketFile}`);
        chmodSync(socketFile, 0o666);
    });

    server.on('error', (err) => {
        console.error('deployd socket error:', err);
    });
};