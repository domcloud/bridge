import {
    checkGet,
    normalizeShellOutput,
} from '../util.js';
import express from 'express';
import runConfig from '../executor/runner.js';
import {
    PassThrough
} from 'stream';
import {
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

const MAX_PAYLOAD = 65535;

/**
 * @param {string} payload
 */
function trimPayload(payload) {
    var length = Buffer.byteLength(payload, 'utf8');
    if (length > MAX_PAYLOAD) {
        var trim_msg = '[message truncated...]\n';
        var trim_len = Buffer.byteLength(trim_msg, 'utf8') + 10;
        return trim_msg + Buffer.from(payload, 'utf8').slice(length - (MAX_PAYLOAD - trim_len)).toString('utf8');
    } else {
        return payload;
    }
}
export async function runConfigInBackground(body, domain, sandbox, callback) {
    let fullLogData = [],
        chunkedLogData = ['Running deployment script... Please wait...\n'],
        startTime = Date.now();
    const write = new PassThrough();
    const headers = {
        'Content-Type': 'text/plain; charset=UTF-8',
    };
    let aborted = false;
    const periodicSender = async () => {
        if (chunkedLogData.length > 0) {
            var chunkk = chunkedLogData;
            chunkedLogData = ['[Chunked data...]\n'];

            await curlPost(callback, normalizeShellOutput(chunkk), { headers })
                .catch(e => {
                    console.error(e);
                });
        }
    }
    periodicSender();
    write.on('data', (chunk) => {
        if (!callback) return;
        chunkedLogData.push(chunk);
        fullLogData.push(chunk);
    });
    write.on('end', () => {
        // and finish message with full log
        if (callback) {
            curlPost(callback, trimPayload(normalizeShellOutput(fullLogData)), { headers })
                .catch(e => {
                    console.error(e);
                });
        }
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
        } else if (typeof error === 'string') {
            await writeAsync(write, `$> Error occured: ${error}\n`);
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
fs.mkdirSync(path.join(__dirname, '../../logs'), { recursive: true });
const childLogger = fs.openSync(path.join(__dirname, `../../logs/${new Date().toISOString().substring(0, 10)}.log`), 'a');
export async function runConfigInBackgroundSingleton(payload) {
    spawn('node', [path.join(process.cwd(), '/runner.js')], {
        stdio: ['ignore', childLogger, childLogger],
        detached: true,
        env: {
            RUNNER_PAYLOAD: JSON.stringify(payload),
        }
    }).unref();
}

export default function () {
    var router = express.Router();
    router.post('/', checkGet(['domain']), async function (req, res, next) {
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


/**
 * Mimics axios.post using curl command.
 * 
 * @param {string} url - The URL to which the request is sent.
 * @param {Object|string} data - The payload to be sent in the request body.
 * @param {Object} config - Configuration object containing headers and other options.
 * @returns {Promise} - A promise that resolves with the response or rejects with an error.
 */
function curlPost(url, data, config = {}) {
    return new Promise((resolve, reject) => {
        // Convert data to string if it's an object
        const payload = typeof data === 'object' ? JSON.stringify(data) : data;

        // Extract headers from config
        const headers = config.headers || {};
        const timeout = config.timeout || 0; // Timeout in seconds

        // Convert headers object to an array of `-H` options for curl
        const headerOptions = Object.entries(headers).flatMap(([key, value]) => ['-H', `${key}: ${value}`]);

        // Prepare the curl command with the necessary arguments
        const curlArgs = [
            '-X', 'POST',
            ...headerOptions,
            '-d', payload,
            url
        ];

        if (timeout > 0) {
            curlArgs.push('--max-time', timeout.toString());
        }

        // Log the curl arguments
        console.log('Curl Command:', 'curl', ...curlArgs);

        const curl = spawn('curl', curlArgs);

        let response = '';
        let errorResponse = '';

        // Capture the standard output
        curl.stdout.on('data', (data) => {
            response += data.toString();
        });

        // Capture the standard error
        curl.stderr.on('data', (data) => {
            errorResponse += data.toString();
        });

        // Handle process close
        curl.on('close', (code) => {
            if (code === 0) {
                resolve(response);
            } else {
                reject(new Error(`Curl process exited with code ${code}: ${errorResponse}`));
            }
        });
    });
}
