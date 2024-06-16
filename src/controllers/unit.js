
import express from 'express';
import { unitExec } from '../executor/unit.js';

export default function () {
    var router = express.Router();
    router.get('/*', async function (req, res, next) {
        try {
            res.json(JSON.parse((await unitExec.get(req.path)).stdout));
        } catch (error) {
            next(error);
        }
    });
    router.post('/*', async function (req, res, next) {
        try {
            res.json(JSON.parse((await unitExec.set(req.path, JSON.stringify(req.body))).stdout));
        } catch (error) {
            next(error);
        }
    });
    return router;
}
