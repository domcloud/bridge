import express from 'express';
import {
    dockerExec as executor
} from '../executor/docker.js';
import {
    checkGet,
    checkPost
} from '../util.js';

export default function () {
    var router = express.Router();
    router.get('/show', checkGet(['user']), async function (req, res, next) {
        try {
            res.json([executor.checkDockerEnabled(req.query.user.toString())]);
        } catch (error) {
            next(error);
        }
    });
    router.post('/add', checkPost(['user']), async function (req, res, next) {
        try {
            res.json(await executor.enableDocker(req.body.user.toString()));
        } catch (error) {
            next(error);
        }
    });
    router.post('/del', checkPost(['user']), async function (req, res, next) {
        try {
            res.json(await executor.disableDocker(req.body.user.toString()));
        } catch (error) {
            next(error);
        }
    });
    return router;
}