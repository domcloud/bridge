import express from 'express'
import dotenv from 'dotenv'
import named from './controllers/named.js';
import nginx from './controllers/nginx.js';
import iptables from './controllers/iptables.js';
import {
    initUtils
} from './util.js';
import runner from './controllers/runner.js';
import virtualmin from './controllers/virtualmin.js';

dotenv.config();
initUtils();

const app = express();

app.use(express.static('public'));
app.use(express.json());
app.use('/named', named());
app.use('/nginx', nginx());
app.use('/iptables', iptables());
app.use('/runner', runner());
app.use('/virtualmin', virtualmin());
app.use(function (err, req, res, next) {
    res.json(err);
});
const port = process.env.PORT ? parseInt(process.env.PORT) : 2223;
app.listen(port);

console.log(`Starting main node on ${port}`);

const cleanUpServer = (code) => {
    console.log(`Exiting main node ${port} with code ${code}`);
};
