import {
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
let lastCheck = 0;
let lastCheckResult = '';
let lastCheckOK = false;

const tmpTest = path.join(process.cwd(), '/.tmp/test')
let lastTest = 0;
let lastTestResult = '';
let lastTestOK = false;


export default function () {
    var router = express.Router();
    router.get('/check', async function (req, res, next) {
        try {
            if (lastCheck < Date.now() - 1000) {
                await spawnSudoUtil('SHELL_CHECK');
                lastCheckResult = cat(tmpCheck);
                lastCheckOK = lastCheckResult.indexOf('"OK"') !== -1;
                lastCheck = Date.now();
            }
            res.status(lastCheckOK ? 200 : 500).json(lastCheckResult);
        } catch (error) {
            next(error);
        }
    });
    router.get('/test', async function (req, res, next) {
        try {
            if (lastTest < Date.now() - 1000) {
                await spawnSudoUtil('SHELL_TEST');
                lastTestResult = cat(tmpTest);
                lastTestOK = lastTestResult.indexOf('"OK"') !== -1;
                lastTest = Date.now();
            }
            res.status(lastTestOK ? 200 : 500).json(lastTestResult);
        } catch (error) {
            next(error);
        }
    });
    return router;
}