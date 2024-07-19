
import express from 'express';
import { unitExec } from '../executor/unit.js';
import { checkGet } from '../util.js';

export default function () {
    var router = express.Router();
    router.get('/config', async function (req, res, next) {
        try {
            let result = await unitExec.get(req.path);
            res.header("content-type", "application/json")
            res.status(200).send(result.stdout);
        } catch (error) {
            next(error);
        }
    });
    router.get('/status', async function (req, res, next) {
        try {
            let result = await unitExec.get(req.path);
            res.header("content-type", "application/json")
            res.status(200).send(result.stdout);
        } catch (error) {
            next(error);
        }
    });
    router.get('/domain', checkGet(['domain']), async function (req, res, next) {
        try {
            const result = await unitExec.get("/config/applications/" + req.query.domain);
            res.header("content-type", "application/json")
            let config = JSON.parse(result.stdout);
            res.status(200).send({
                config: unitExec.unsandbox(config),
                raw: config,
            });
        } catch (error) {
            next(error);
        }
    });
    router.post('/config/*', async function (req, res, next) {
        try {
            let result = await unitExec.set("/config" + req.path, JSON.stringify(req.body));
            res.header("content-type", "application/json")
            res.status(200).send(result.stdout);
        } catch (error) {
            next(error);
        }
    });
    return router;
}
