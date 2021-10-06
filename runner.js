import { runConfigInBackground } from "./src/controllers/runner.js";

process.on('message', (msg) => {
    // @ts-ignore
    const { body, domain, sandbox, callback } = msg;
    runConfigInBackground(body, domain, sandbox, callback);
});

console.log(`Starting runner node ${process.pid}`);
process.on('exit', (code) => {
    console.log(`Exiting runner node ${process.pid} with code ${code}`);
});