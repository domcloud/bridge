import {
    cat,
    getRevision,
    getSupportVersions,
    getVersion,
    spawnSudoUtil,
} from '../util.js';
import express from 'express';
import path from 'path';
import { fixNGINX, fixPHP } from '../executor/pulse.js';

const tmpCheck = path.join(process.cwd(), '/.tmp/check')
const tmpTest = path.join(process.cwd(), '/.tmp/test')
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
    router.get('/check', async function (req, res, next) {
        try {
            if (lastCheck < Date.now() - refreshTime) {
                await spawnSudoUtil('SHELL_CHECK');
                lastCheckResult = JSON.parse(cat(tmpCheck));
                lastCheckOK = lastCheckResult.status == 'OK';
                lastCheck = Date.now();
            }
            res.status(lastCheckOK ? 200 : 500).json(lastCheckResult);
            if (lastCheckOK) {
                return;
            }
            let lastTestResult = null;
            for (const [key, val] of Object.entries(lastCheckResult.statuses)) {
                if (val != "failed") {
                    continue;
                }
                if (key.endsWith("-php-fpm")) {
                    if (!lastTestResult) {
                        await spawnSudoUtil('SHELL_TEST');
                        lastTestResult = JSON.parse(cat(tmpTest));
                    }
                    await fixPHP(lastTestResult);
                } else if (key == "nginx") {
                    if (!lastTestResult) {
                        await spawnSudoUtil('SHELL_TEST');
                        lastTestResult = JSON.parse(cat(tmpTest));
                    }
                    await fixNGINX(lastTestResult);
                }
            }
        } catch (error) {
            next(error);
        }
    });
    router.get('/test', async function (req, res, next) {
        try {
            if (lastTest < Date.now() - refreshTime) {
                await spawnSudoUtil('SHELL_TEST');
                lastTestResult = JSON.parse(cat(tmpTest));
                lastTestOK = lastTestResult.status == 'OK';
                lastTest = Date.now();
            }
            res.status(lastTestOK ? 200 : 500).json(lastTestResult);
        } catch (error) {
            next(error);
        }
    });
    return router;
}