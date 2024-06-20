#!/usr/bin/env node

// kill all processes that outside SSH and root

import cli from 'cli'
import shelljs from 'shelljs';
import { existsSync, readdirSync } from 'fs';

const LOGINLINGERDIR = process.env.LOGINLINGERDIR || '/var/lib/systemd/linger';

const { exec } = shelljs;

const opts = cli.parse({
    test: ['t', 'Test mode', 'bool', false],
    ignore: ['i', 'Ignore user list', 'string', ''],
});

const psOutput = exec('ps -eo user:70,pid,etimes,command --forest --no-headers', {
    silent: true,
    fatal: true,
}).stdout.trim().split('\n');

const whoOutput = exec('who', {
    silent: true,
    fatal: true,
}).stdout.trim().split('\n');

const ignoreUsers = opts.ignore ? opts.ignore.split(',')
    .reduce((acc, cur) => {
        acc[cur] = true;
        return acc;
    }, {}) : {};

if (existsSync(LOGINLINGERDIR)) {
    const lingerFiles = readdirSync(LOGINLINGERDIR, { withFileTypes: true });
    Object.assign(ignoreUsers, lingerFiles.map(x => x.name).filter(x => x).reduce((acc, cur) => {
        acc[cur] = true;
        return acc;
    }, {}))
}

ignoreUsers.root = true;

if (opts.test) {
    console.log('Ignoring users: ' + Object.keys(ignoreUsers).join(','));
}

// process and filter output
const splitTest = /^([\w.-]+\+?) +(\d+) +(\d+) (.+)$/;
const lists = psOutput
    .map(x => splitTest.exec(x))
    .filter(x => x !== null && !ignoreUsers[x[1]]).map(match => ({
        user: match[1],
        pid: match[2],
        etimes: parseInt(match[3]),
        command: match[4],
    }));

for (const item of whoOutput) {
    ignoreUsers[item.match(/^[\w.-]+/)[0]] = true;
}

// scan for any processes not in ssh sessions or longer than 3 hours
let candidates = lists.filter(x => x.etimes > 10800 || (x.command[0] != ' ' && !ignoreUsers[x.user] && x.etimes > 60));

if (opts.test) {
    console.table(candidates);
} else {
    for (let x of candidates) {
        exec(`kill -9 ${x.pid}`);
    }
}
