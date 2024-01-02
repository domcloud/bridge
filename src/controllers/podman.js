import express from 'express';
import {
    podmanExec as executor
} from '../executor/podman.js';
import {
    checkGet,
    checkPost
} from '../util.js';

export default function () {
    var router = express.Router();
    router.get('/show', checkGet(['user']), async function (req, res, next) {
        try {
            res.json([executor.checkPodmanEnabled(req.query.user.toString())]);
        } catch (error) {
            next(error);
        }
    });
    router.post('/add', checkPost(['user']), async function (req, res, next) {
        try {
            res.json(await executor.enablePodman(req.body.user.toString()));
        } catch (error) {
            next(error);
        }
    });
    router.post('/del', checkPost(['user']), async function (req, res, next) {
        try {
            res.json(await executor.disablePodman(req.body.user.toString()));
        } catch (error) {
            next(error);
        }
    });
    return router;
}