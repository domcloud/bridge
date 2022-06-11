import dotenv from 'dotenv';
import {
    runConfigInBackground
} from "./src/controllers/runner.js";
import {
    initUtils
} from './src/util.js';

dotenv.config();
initUtils();

const payload = JSON.parse(process.argv[2]);
console.log(`Executing`, payload);
const cleanUpServer = ( /** @type {any} */ code) => {
    console.log(`Exiting runner node ${process.pid} with code ${code}`);
};
[`exit`, `SIGINT`, `SIGUSR1`, `SIGUSR2`, `uncaughtException`, `SIGTERM`].forEach((eventType) => {
    process.on(eventType, cleanUpServer.bind(null, eventType));
})

// @ts-ignore
const {
    body,
    domain,
    sandbox,
    callback
} = payload;

runConfigInBackground(body, domain, sandbox, callback).catch(err => {
    console.error(err);
});

console.log(`Starting runner node ${process.pid}`);