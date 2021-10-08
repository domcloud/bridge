import dotenv from 'dotenv';
import {
    runConfigInBackground
} from "./src/controllers/runner.js";
import {
    checkTheLock,
    executeLock,
    initUtils
} from './src/util.js';
import {
    Reply
} from 'zeromq';

dotenv.config();
initUtils();

async function main() {
    const sock = new Reply();

    await sock.bind('tcp://*:2223');

    for await (const [msg] of sock) {
        const payload = JSON.parse(msg.toString());
        console.log(`Executing`, payload);
        await sock.send("OK");
        // @ts-ignore
        const {
            body,
            domain,
            sandbox,
            callback
        } = payload;
        try {
            runConfigInBackground(body, domain, sandbox, callback).catch(err => {
                console.error(err);
            });
            resetIdleTimer();
        } catch (error) {
            console.error(error);
        }
    }
}

console.log(`Starting runner node ${process.pid}`);

checkTheLock('runner').then((lock) => {
    if (lock) {
        console.log('Runner is already running');
        process.exit();
    } else {
        executeLock('runner', main).catch(err => {
            console.error(err);
            process.exit(1);
        })
    }
});

const cleanUpServer = (code) => {
    console.log(`Exiting runner node ${process.pid} with code ${code}`);
};
[`exit`, `SIGINT`, `SIGUSR1`, `SIGUSR2`, `uncaughtException`, `SIGTERM`].forEach((eventType) => {
    process.on(eventType, cleanUpServer.bind(null, eventType));
})

var timer;

function resetIdleTimer() {
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(function () {
        process.exit();
    }, 60 * 60 * 1000);
}