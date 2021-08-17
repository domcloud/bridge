import express from 'express';
import {
    checkAuth,
    checkGet,
    executeLock,
    spawnSudoUtil
} from '../util';
import {generate, parse} from '../parsers/named';
import { cat } from 'shelljs';
import path from 'path';

const tmpFile = path.join(process.cwd(), '/.tmp/named')

export default function () {
    var router = express.Router();
    router.post('/resync', checkAuth, checkGet(['domain']), async function (req, res) {
        await spawnSudoUtil('NAMED_SYNC', ["" + req.query.domain]);
        res.json("OK");
    });
    router.get('/show', checkAuth, checkGet(['domain']), async function (req, res) {
        res.json(parse(await executeLock('named', () => {
            return spawnSudoUtil('NAMED_GET', ["" + req.query.domain]);
        })));
    });
    router.post('/add', checkAuth, checkGet(['domain', 'type']), async function (req, res) {
        await executeLock('named', async () => {
            await spawnSudoUtil('NAMED_GET', ["" + req.query.domain]);
            var file = cat(tmpFile
        });
        res.json("OK");
    });
    return router;
}