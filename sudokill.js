#!/usr/bin/env node

// kill all processes that outside SSH and root or exceed memory limit

import { execSync } from 'child_process';
import cli from 'cli';
import { existsSync, readdirSync } from 'fs';

const LOGINLINGERDIR = process.env.LOGINLINGERDIR || '/var/lib/systemd/linger';
const MAX_MEM_KB = (parseInt(process.env.MAX_PROCESS_MEM_MB) || 64) * 1024;

const opts = cli.parse({
    test: ['t', 'Test mode', 'bool', false],
    ignore: ['i', 'Ignore user list', 'string', ''],
});

const psOutput = execSync('ps -eo user:70,pid,uid,vsz,etimes,command --forest --no-headers').toString('utf-8').trim().split('\n');

// check logged in users
const whoOutput = execSync('who').toString('utf-8').trim().split('\n').filter(x => x);

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
const splitTest = /^([\w.-]+\+?) +(\d+) +(\d+) +(\d+) +(\d+) (.+)$/;
const lists = psOutput
    .map(x => splitTest.exec(x))
    .filter(x => x !== null)
    .map(match => ({
        user: match[1],
        pid: match[2],
        uid: parseInt(match[3]),
        vsz: parseInt(match[4]),
        etimes: parseInt(match[5]),
        command: match[6],
    }));

for (const item of whoOutput) {
    const userMatch = item.match(/^[\w.-]+/);
    if (userMatch) ignoreUsers[userMatch[0]] = true;
}

if (opts.test) {
    console.log('Ignoring users: ' + Object.keys(ignoreUsers).join(','));
    console.log(`Memory Limit: ${MAX_MEM_KB / 1024}MB (${MAX_MEM_KB} KB)`);
}

// Kill if:
// 1. User is NOT root/ignored/logged in AND process is > 3 hours old
// 2. User is NOT root/ignored/logged in AND process exceeds MAX_MEM_KB
let candidates = lists.filter(x => {
    const isProtected = (x.command[0] == ' ' || x.uid <= 1001 || ignoreUsers[x.user]);
    
    if (isProtected) return false;

    const isTooOld = x.etimes >= 10800;
    const isTooLarge = x.vsz > MAX_MEM_KB;

    return isTooOld || isTooLarge;
});

if (opts.test) {
    console.table(candidates);
} else {
    for (let x of candidates) {
        try {
            execSync(`pkill -KILL -P ${x.pid}`);
            execSync(`kill -9 ${x.pid}`);
        } catch (e) {
        }
    }
}
