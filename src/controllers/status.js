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

const tmpStatus = path.join(process.cwd(), '/.tmp/status')
let lastStatus = 0;
let lastStatusResult = '';
let lastStatusOK = false;

export default function () {
    var router = express.Router();
    router.get('/', async function (req, res, next) {
        try {
            if (lastStatus < Date.now() - 1000) {
                await spawnSudoUtil('SHELL_CHECK');
                lastStatusResult = cat(tmpStatus);
                lastStatusOK = lastStatusResult.indexOf('"OK"') !== -1;
                lastStatus = Date.now();
            }
            res.status(lastStatusOK ? 200 : 500).send(lastStatusResult);
        } catch (error) {
            next(error);
        }
    });
    return router;
}