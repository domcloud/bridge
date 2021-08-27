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

const port = process.argv.length > 2 ? parseInt(process.argv[2]) : 3000;
app.listen(port);
console.log(`Listening in http://localhost:${port}`);