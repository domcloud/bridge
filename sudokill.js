#!/usr/bin/env node

// kill all processes that outside SSH and root

import shelljs from 'shelljs';
import cli from 'cli'
const { exec } = shelljs;

const opts = cli.parse({
    test: ['t', 'Test mode', 'bool', false],
    ignore: ['i', 'Ignore user list', 'string', ''],
});

const output = exec('ps -eo user:20,pid,command --forest --no-headers', {
    silent: true,
    fatal: true,
}).stdout.trim().split('\n');

const ignoreUsers = opts.ignore.split(',')
    .map(x => x.trim())
    .filter(x => x.length > 0)
    .reduce((acc, cur) => {
        acc[cur] = true;
        return acc;
    }, {});

ignoreUsers.root = true;

// scan for any user that is in sd-pam sessions

const sdPamTest = /^([\w.-]+\+?) +\d+  \\_ \(sd-pam\)$/;
const sdPamUsers = output
    .map(x => sdPamTest.exec(x))
    .filter(x => x !== null)
    .map(x => x[1]);

for (let user of sdPamUsers) {
    ignoreUsers[user] = true;
}

const rootPsTest = /^([\w.-]+\+?) +(\d+) \S.+/;
let candidates = output
    .map(x => rootPsTest.exec(x))
    .filter(x => x !== null)
    .map(x => ({ user: x[1], pid: x[2], proc: x[0] }))
    .filter(x => !ignoreUsers[x.user]);

if (opts.test) {
    console.log(candidates.map(x => x.proc).join('\n'));
} else {
    for (let x of candidates) {
        exec(`kill -9 ${x.pid}`);
    }
}
