import express from 'express'
import dotenv from 'dotenv'
import logman from './controllers/logman.js';
import named from './controllers/named.js';
import nginx from './controllers/nginx.js';
import status from './controllers/status.js';
import iptables from './controllers/iptables.js';
import screend from './controllers/screend.js';
import {
    checkAuth,
    initUtils
} from './util.js';
import runner from './controllers/runner.js';
import virtualmin from './controllers/virtualmin.js';
import podman from './controllers/podman.js';

const startTime = Date.now();
dotenv.config();
initUtils();

const app = express();

app.use(express.static('public'));
app.use(express.json());
app.use('/status', status());
app.use(checkAuth);
app.use('/logman', logman());
app.use('/named', named());
app.use('/nginx', nginx());
app.use('/iptables', iptables());
app.use('/screend', screend());
app.use('/podman', podman());
app.use('/runner', runner());
app.use('/virtualmin', virtualmin());
app.use(function (err, req, res, next) {
    if (err instanceof Error) {
        res.status(500);
        res.json(err);    
    } else {
        res.status(403);
        res.json(err);    
    }
});
const port = process.env.PORT ? parseInt(process.env.PORT) : 2223;

app.listen(port, function () {
    console.log(`Start time takes ` + (Date.now() - startTime) / 1000 + ` s`)
    console.log(`Listening on ${port}`);
})

