#!/usr/bin/env node

// kill all processes that outside SSH and root

import shelljs from 'shelljs';
import cli from 'cli'
const { exec } = shelljs;

const opts = cli.parse({
    test: ['t', 'Test mode', 'bool', false],
    ignore: ['i', 'Ignore user list', 'string', ''],
});

const output = exec('ps -eo user:20,pid,etimes,command --forest --no-headers', {
    silent: true,
    fatal: true,
}).stdout.trim().split('\n');

const ignoreUsers = opts.ignore.split(',')
    .reduce((acc, cur) => {
        acc[cur] = true;
        return acc;
    }, {});

ignoreUsers.root = true;

// process and filter output
const splitTest = /^([\w.-]+\+?) +(\d+) +(\d+) (.+)$/;
const lists = output
    .map(x => splitTest.exec(x))
    .filter(x => x !== null && !ignoreUsers[x[1]]).map(match => ({
        raw: match[0],
        user: match[1],
        pid: match[2],
        etimes: match[3],
        command: match[4],
    }));

for (const item of lists) {
    if (item.command === ' \\_ (sd-pam)') {
        ignoreUsers[item.user] = true;
    }
}

// scan for any processes not in ssh sessions or longer than 3 hours
let candidates = lists.filter(x => parseInt(x.etimes) > 10800 || (x.command[0] != ' ' && !ignoreUsers[x.user]));

if (opts.test) {
    console.log(candidates.map(x => x.raw).join('\n'));
} else {
    for (let x of candidates) {
        exec(`kill -9 ${x.pid}`);
    }
}
