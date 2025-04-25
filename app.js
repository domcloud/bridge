import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(__dirname);

import app from './src/index.js';

const port = process.env.PORT ? parseInt(process.env.PORT) : 2223;
const server = app.listen(port, function () {
    console.log(`Start time takes ` + Math.round(process.uptime() * 1000) / 1000 + `s`)
    console.log(`Listening at http://localhost:${port} with env ${process.env.NODE_ENV}`);
})
server.on('close', () => {
    console.log(`Server closing`);
    setTimeout(() => {
        console.log(`Server force closing`);
        process.exit(0);
    }, 2000).unref();
})
