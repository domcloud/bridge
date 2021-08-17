import express from 'express'
import dotenv from 'dotenv'
import expressWs from 'express-ws';

dotenv.config();
const app = express();
const eWs = expressWs(app);


app.use(express.static('public'));

app.use

app.listen(3000)