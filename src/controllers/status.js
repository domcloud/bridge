import {
    cat,
    checkGet,
    getAuth,
    getRevision,
    getSupportVersions,
    getVersion,
    spawnSudoUtil,
} from '../util.js';
import express from 'express';
import path from 'path';
import os from 'os';
import { fixNGINX, fixPHP } from '../executor/pulse.js';
import { portmanExec } from '../executor/portman.js';

const webminStat = '/var/webmin/modules/authentic-theme/real-time-monitoring.json';
const refreshTime = 15000;

let lastCheck = 0;
let lastCheckResult = {};
let lastCheckOK = false;

let lastTest = 0;
let lastTestResult = {};
let lastTestOK = false;

export default function () {
    var router = express.Router();
    router.get('/about', async function (req, res, next) {
        res.json({
            version: getVersion(),
            revision: getRevision(),
            supportVersions: getSupportVersions(),
        })
    });
    router.get('/ip', async function (req, res, next) {
        if (getAuth(req)) {
            const arch = os.machine();
            const cpu = os.cpus().length;
            const mem = os.totalmem() / 1024 / 1024 / 1024;
            res.json({ ip: req.ip, arch, cpu, mem, granted: true })
        } else {
            res.json({ ip: req.ip })
        }
    });
    router.get('/ping', async function (req, res, next) {
        res.contentType('text/plain')
        if (!lastCheckResult?.status || lastCheckResult.status == 'OK') {
            res.status(200).send("pong");
        } else {
            res.status(500).send("/status/check was failed last time");
        }
    });
    router.get('/check', async function (req, res, next) {
        try {
            add_cors(res);
            if (req.method === 'OPTIONS') {
                res.status(204).end();
                return;
            }

            let lastTestResult = null;
            if (lastCheck < Date.now() - refreshTime) {
                const r = await spawnSudoUtil('SHELL_CHECK');
                lastCheckResult = JSON.parse(r.stdout);
                lastCheckOK = lastCheckResult.status == 'OK';
                lastCheck = Date.now();
            }
            if (!lastCheckOK) {
                for (const [key, val] of Object.entries(lastCheckResult.statuses)) {
                    if (val != "failed") {
                        continue;
                    }
                    if (key.endsWith("-php-fpm")) {
                        if (!lastTestResult) {
                            const r = await spawnSudoUtil('SHELL_TEST');
                            lastTestResult = JSON.parse(r.stdout);
                        }
                        await fixPHP(lastTestResult);
                    } else if (key == "nginx") {
                        if (!lastTestResult) {
                            const r = await spawnSudoUtil('SHELL_TEST');
                            lastTestResult = JSON.parse(r.stdout);
                        }
                        await fixNGINX(lastTestResult);
                    }
                }
            }
            res.status(lastCheckOK ? 200 : 500).json({ ...lastCheckResult, test: lastTestResult || undefined });
        } catch (error) {
            next(error);
        }
    });
    router.get('/test', async function (req, res, next) {
        try {
            add_cors(res);
            if (req.method === 'OPTIONS') {
                res.status(204).end();
                return;
            }

            if (lastTest < Date.now() - refreshTime) {
                const r = await spawnSudoUtil('SHELL_TEST');
                lastTestResult = JSON.parse(r.stdout);
                lastTestOK = lastTestResult.status == 'OK';
                lastTest = Date.now();
            }
            if (lastTestResult.codes.nginx === 1) {
                await fixNGINX(lastTestResult);
            }
            if (lastTestResult.codes.fpms.some(x => x > 0)) {
                await fixPHP(lastTestResult);
            }
            res.status(lastTestOK ? 200 : 500).json(lastTestResult);
        } catch (error) {
            next(error);
        }
    });
    router.get('/repquota', async function (req, res, next) {
        let spawn = await spawnSudoUtil('SHELL_SUDO', ["root", "repquota", "-a"]);
        res.setHeader('content-type', 'text/plain').send(spawn.stdout);
    });
    router.get('/stats', async function (req, res, next) {
        add_cors(res);
        if (req.method === 'OPTIONS') {
            res.status(204).end();
            return;
        }
        let spawn = await spawnSudoUtil('FILE_GET', ["root", webminStat]);
        res.setHeader('content-type', 'application/json').send(spawn.stdout);
    });
    router.get('/ports', async function (req, res, next) {
        add_cors(res);
        if (req.method === 'OPTIONS') {
            res.status(204).end();
            return;
        }
        let ports = await portmanExec.listPortsExtended();
        res.setHeader('content-type', 'application/json').send(JSON.stringify(ports));
    });
    router.get('/opcache', checkGet(['version']), async function (req, res, next) {
        try {
            const queryStr = new URL(req.url, `http://${req.headers.host}`).search.substring(1);
            await spawnSudoUtil("OPCACHE_STATUS_HTML", [req.query.version.toString(), queryStr])
            const text = await cat(path.join(process.cwd(), '/.tmp/opcache'));
            res.setHeader('content-type', 'text/html').send(text);
            return;
        } catch (error) {
            next(error);
        }
    });
    return router;
}

function add_cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}