import 'dotenv/config.js'
import express from 'express'
import logman from './controllers/logman.js';
import named from './controllers/named.js';
import nginx from './controllers/nginx.js';
import status from './controllers/status.js';
import nftables from './controllers/nftables.js';
import redis from './controllers/redis.js';
import screend from './controllers/screend.js';
import { checkAuth, initUtils, initDeployd } from './util.js';
import runner from './controllers/runner.js';
import virtualmin from './controllers/virtualmin.js';
import docker from './controllers/docker.js';
import unit from './controllers/unit.js';
import swaggerUi from 'swagger-ui-express';
import swaggerDocs from './controllers/swagger.cjs';

initUtils();
initDeployd();

const app = express();
app.set('trust proxy', 'loopback');
app.use(express.static('public'));
app.use(express.json());
app.use('/status', status());
app.use('/swagger', swaggerUi.serve, swaggerUi.setup(swaggerDocs));
app.use('/filestash', async function (req, res, next) {
    try {
        const baseUrl = process.env.FILESTASH_URL;
        if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
            res.status(404).end();
        }
        const url = new URL(req.url, baseUrl);
        res.redirect(baseUrl + "/login" + url.search);
    } catch (error) {
        next(error);
    }
});

// all endpoints need auth
app.use(checkAuth);
app.use('/logman', logman());
app.use('/named', named());
app.use('/nginx', nginx());
app.use('/nftables', nftables());
app.use('/screend', screend());
app.use('/redis', redis());
app.use('/docker', docker());
app.use('/runner', runner());
app.use('/virtualmin', virtualmin());
app.use('/unit', unit());
app.use(function (err, req, res, next) {
    if (err instanceof Error) {
        res.status(500);
        res.json({
            stack: err.stack,
            name: err.name,
            message: err.message,
            ...err,
        });
    } else {
        res.status(403);
        res.json(err);
    }
});

export default app;

