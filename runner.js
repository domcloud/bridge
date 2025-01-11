import dotenv from 'dotenv';
import { runConfigInBackground } from "./src/controllers/runner.js";
import { initUtils } from './src/util.js';
import { RunnerPayload } from './src/executor/runner.js';

dotenv.config();
initUtils();

const payload = JSON.parse(process.env.RUNNER_PAYLOAD);
console.log(`Executing`, payload);
const cleanUpServer = ( /** @type {any} */ code, msg) => {
    console.log(`Exiting runner node ${process.pid} with code ${code}`);
    if (msg) {
        console.log('Additional context: ' + JSON.stringify(msg, Object.getOwnPropertyNames(msg)));
    }
};
[`exit`, `SIGINT`, `SIGUSR1`, `SIGUSR2`, `uncaughtException`, `SIGTERM`].forEach((eventType) => {
    process.on(eventType, cleanUpServer.bind(null, eventType));
})

runConfigInBackground(new RunnerPayload(payload)).catch(err => {
    console.error(err);
});

console.log(`Starting runner node ${process.pid}`);