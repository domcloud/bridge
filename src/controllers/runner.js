import {
    checkAuth,
    checkGet,
    checkTheLock,
    normalizeShellOutput,
} from '../util.js';
import express from 'express';
import runConfig from '../executor/runner.js';
import {
    PassThrough
} from 'stream';
import {
    execSync,
    spawn
} from 'child_process';
import path from 'path';
import fs from 'fs';
import {
    fileURLToPath
} from 'url';
import {
    dirname
} from 'path';
import axios from 'axios';
import {
    AbortController
} from 'node-abort-controller';

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

export async function runConfigInBackground(body, domain, sandbox, callback) {
    let fullLogData = '',
        chunkedLogData = 'Running runner... Please wait...\n',
        delay = 5000,
        startTime = Date.now();
    const write = new PassThrough();
    const headers = {
        'Content-Type': 'text/plain; charset=UTF-8',
    };
    let aborted = false,
        periodicAbort = null;
    const cancelController = new AbortController();
    const periodicSender = async () => {
        periodicAbort = null;
        var prefix = (fullLogData ? '[Chunked data...]\n' : '');
        try {
            if (chunkedLogData != '') {
                var chunkk = chunkedLogData;
                chunkedLogData = '';
                await axios.post(callback, prefix + normalizeShellOutput(chunkk), {
                    headers,
                    signal: cancelController.signal,
                });
            }
        } finally {
            if (!cancelController.signal.aborted)
                periodicAbort = setTimeout(periodicSender, delay);
        }
    }
    periodicSender();
    write.on('data', (chunk) => {
        if (!callback) return;
        chunkedLogData += chunk;
        fullLogData += chunk;
    });
    write.on('end', () => {
        cancelController.abort()
        periodicAbort && clearTimeout(periodicAbort);
        // and finish message with full log
        if (callback)
            axios.post(callback, normalizeShellOutput(fullLogData), {
                headers
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
        } else if (error.message) {
            await writeAsync(write, `$> Error occured: ${error.message}\n`);
            await writeAsync(write, ('' + error.stack).split('\n').map(x => `$>   ${x}`).join('\n') + '\n');
        } else {
            await writeAsync(write, '$> Error occured\n');
            await writeAsync(write, JSON.stringify(error, Object.getOwnPropertyNames(error)) + '\n');
        }
        aborted = true;
    } finally {
        console.log('!> finish');
        await writeAsync(write, `\n$> Execution ${aborted ? 'Aborted' : 'Finished'} in ${(Date.now() - startTime) / 1000}s\n`);
        if (write && !write.writableEnded) {
            write.end();
        }
    }
}

const __filename = fileURLToPath(
    import.meta.url);
const __dirname = dirname(__filename);
const childLogger = fs.openSync(path.join(__dirname, `../../logs/${new Date().toISOString().substr(0, 10)}.log`), 'a');
export async function runConfigInBackgroundSingleton(payload) {
    spawn('node', [path.join(process.cwd(), '/runner.js'), JSON.stringify(payload)], {
        stdio: ['ignore', childLogger, childLogger],
        detached: true,
    }).unref();
}

export default function () {
    var router = express.Router();
    router.post('/', checkAuth, checkGet(['domain']), async function (req, res, next) {
        runConfigInBackgroundSingleton({
            body: req.body,
            domain: req.query.domain + "",
            sandbox: !!parseInt(req.query.sandbox + '' || '0'),
            callback: req.header('x-callback'),
        });
        res.send('OK');
    });
    return router;
}