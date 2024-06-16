
import express from 'express';
import { unitExec } from '../executor/unit.js';

export default function () {
    var router = express.Router();
    router.get('/', async function (req, res, next) {
        try {
            res.json(unitExec.get(req.path));
        } catch (error) {
            next(error);
        }
    });
    router.post('/', async function (req, res, next) {
        try {
            res.json(unitExec.set(req.path, JSON.stringify(req.body)));
        } catch (error) {
            next(error);
        }
    });
    return router;
}
