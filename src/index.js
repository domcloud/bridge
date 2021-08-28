import express from 'express'
import dotenv from 'dotenv'
import expressWs from 'express-ws';
import named from './named/index.js';
import nginx from './nginx/index.js';
import iptables from './iptables/index.js';
import { initUtils } from './util.js';

dotenv.config();
initUtils();

const app = express();
const eWs = expressWs(app);

app.use(express.static('public'));

app.use('/named', named());
app.use('/nginx', nginx());
app.use('/iptables', iptables());
app.use(function (err, req, res, next) {
    res.json(err);
});
const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
app.listen(port);
console.log(`Listening in http://localhost:${port}`);