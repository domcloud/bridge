import {
    getRevision,
    getSupportVersions,
    getVersion,
    spawnSudoUtil,
} from '../util.js';
import express from 'express';
import path from 'path';
import shelljs from 'shelljs';

const {
    cat,
    ShellString
} = shelljs;

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