import {
    checkAuth,
    checkGet,
} from '../util.js';
import express from 'express';
import runConfig from '../executor/runner.js';
import axios from 'axios';
export default function () {
    var router = express.Router();
    router.post('/', checkAuth, checkGet(['domain']), async function (req, res, next) {
        try {
            let stream = '';
            await runConfig(req.body || {}, req.query.domain + "", (s) => {
                res.write(s)
                stream += s;
            }, false);
            if (req.header('x-callback'))
            axios.post(req.header('x-callback'), stream, {
                headers: {
                    'content-type': 'text/plain'
                }
            });
            res.end();
        } catch (error) {
            res.write(error.message);
            res.write(error.stack);
            res.end();
        }
    });
    return router;
}