import express from 'express';
import {
    checkGet,
    checkPost,
} from '../util.js';
import { screendExecutor } from '../executor/screend.js';

export default function () {
    var router = express.Router();
    router.get('/list', checkGet(['user']), async function (req, res, next) {
        try {
            res.json(await screendExecutor.list(req.query.user.toString()));
        } catch (error) {
            next(error);
        }
    });
    router.post('/manage', checkPost(['user', 'command']), async function (req, res, next) {
        try {
            if (!['start', 'stop', 'restart', 'remove', 'add'].includes(req.body.command)) {
                throw new Error('Invalid command');
            }
            res.json(await screendExecutor.execute(req.body.user.toString(), req.body.command.toString(), req.body.program));
        } catch (error) {
            next(error);
        }
    });
    return router;
}
