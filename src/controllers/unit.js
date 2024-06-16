
import express from 'express';
import { unitExec } from '../executor/unit.js';

export default function () {
    var router = express.Router();
    router.get('/*', async function (req, res, next) {
        try {
            let result = await unitExec.get(req.path);
            res.header("content-type", "application/json")
            res.status(200).send(result.stdout);
        } catch (error) {
            next(error);
        }
    });
    router.post('/*', async function (req, res, next) {
        try {
            let result = await unitExec.set(req.path, JSON.stringify(req.body));
            res.header("content-type", "application/json")
            res.status(200).send(result.stdout);
        } catch (error) {
            next(error);
        }
    });
    return router;
}
