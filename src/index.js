import express from 'express'
import dotenv from 'dotenv'
import expressWs from 'express-ws';
import named from './named/index.js';
import nginx from './nginx/index.js';
import iptables from './iptables/index.js';

dotenv.config();
const app = express();
const eWs = expressWs(app);

app.use(express.static('public'));

app.use('/named', named());
app.use('/nginx', nginx());
app.use('/iptables', iptables());

app.listen(3000);
console.log('Listening in http://localhost:3000');