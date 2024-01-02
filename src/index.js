import express from 'express'
import dotenv from 'dotenv'
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

dotenv.config();
initUtils();

const app = express();

app.use(express.static('public'));
app.use(express.json());
app.use('/status', status());
app.use(checkAuth);
app.use('/named', named());
app.use('/nginx', nginx());
app.use('/iptables', iptables());
app.use('/screend', screend());
app.use('/podman', podman());
app.use('/runner', runner());
app.use('/virtualmin', virtualmin());
app.use(function (err, req, res, next) {
    res.status(500);
    res.json(err);
});
const port = process.env.PORT ? parseInt(process.env.PORT) : 2223;
app.listen(port, function () {
    console.log(`Listening on ${port}`);
})

