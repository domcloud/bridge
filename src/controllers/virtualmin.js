import express from 'express';
import { virtualminExec } from '../executor/virtualmin';
import { checkAuth, checkGet } from '../util';

export default function () {
    var router = express.Router();
    router.get('/create-link', checkAuth, checkGet(['user']), async function (req, res, next) {
        res.send((await virtualminExec.execFormatted('create-link-login', {
            user: req.query.user,
        })));
    });
    return router;
}