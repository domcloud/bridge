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
export default function () {
    var router = express.Router();
    router.post('/', checkAuth, checkGet(['domain']), async function (req, res, next) {
        /** @type {import('stream').Writable} */
        let write = res;
        try {
            let callback = req.header('x-callback');
            let callbackChunked = !!parseInt(req.header('x-callback-chunked') || '0');
            await runConfig(req.body || {}, req.query.domain + "", async (s) => {
                if (callback && !write) {
                    res.json('OK');
                    console.log('begin emit ' + callback);
                    if (callbackChunked) {
                        write = got.stream.post(callback);
                    } else {
                        let sss = '';
                        write = new PassThrough();
                        write.on('data', (chunk) => {
                            if (!sss)
                                // for startup message
                                got.post(callback, {
                                    headers: {
                                        'Content-Type': 'text/plain',
                                    },
                                    body: 'Running runner... Please wait...\n' + sss
                                });
                            sss += chunk;
                        });
                        write.on('end', () => {
                                // and finish message
                                got.post(callback, {
                                headers: {
                                    'Content-Type': 'text/plain',
                                },
                                body: sss
                            });
                        });
                    }
                }
                console.log('> ' + s);
                await writeAsync(write, s);
            }, !!parseInt(req.query.sandbox + '' || '0'));
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
                await promisify(write.end)();
            }
            if (!res.writableEnded) {
                await promisify(res.end)();
            }
        }
    });
    return router;
}