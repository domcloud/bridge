import {
    checkAuth,
    checkGet,
} from '../util.js';
import express from 'express';
import runConfig from '../executor/runner.js';
import got from 'got';
import {
    promisify
} from 'util';
import {
    PassThrough
} from 'stream';

/**
 * @param {import('stream').Writable} stream
 * @param {string} content
 */
function writeAsync(stream, content) {
    return new Promise((resolve, reject) => {
        stream.write('' + content, 'utf-8', (err) => {
            if (err)
                reject(err)
            else
                resolve();
        })
    });
}

async function runConfigInBackground(body, domain, sandbox, callback) {
    let sss = '';
    const write = new PassThrough();
    const headers = {
        'Content-Type': 'text/plain',
    };
    write.on('data', (chunk) => {
        if (!sss)
            // for startup message
            got.post(callback, {
                headers,
                body: 'Running runner... Please wait...\n' + chunk,
            });
        sss += chunk;
    });
    write.on('end', () => {
        // and finish message
        got.post(callback, {
            headers,
            body: sss
        });
    });
    try {
        await runConfig(body || {}, domain + "", async (s) => {
            console.log('> ' + s);
            await writeAsync(write, s);
        }, sandbox);
    } catch (error) {
        console.log('!> ', error);
        if (error.stdout !== undefined) {
            await writeAsync(write, `$> Error occured with exit code ${error.code || 'unknown'}\n`);
            await writeAsync(write, error.stdout + '\n');
            await writeAsync(write, error.stderr + '\n');
        } else {
            await writeAsync(write, '$> Error occured\n');
            await writeAsync(write, JSON.stringify(error) + '\n');
        }
    } finally {
        console.log('!> finish');
        await writeAsync(write, '\n$> Execution Finished\n');
        if (write && !write.writableEnded) {
            write.end();
        }
    }
}
export default function () {
    var router = express.Router();
    router.post('/', checkAuth, checkGet(['domain']), async function (req, res, next) {
        setTimeout(function () {
            runConfigInBackground(req.body, req.query.domain + "",
                !!parseInt(req.query.sandbox + '' || '0'), req.header('x-callback')
            );
        }, 1000)
        res.json('OK');
    });
    return router;
}