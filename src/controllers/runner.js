import {
    checkGet,
    normalizeShellOutput,
    spawnSudoUtil,
} from '../util.js';
import express from 'express';
import runConfig, { RunnerPayload } from '../executor/runner.js';
import {
    PassThrough
} from 'stream';
import {
    exec,
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
import request from '../request.js';
import { virtualminExec } from '../executor/virtualmin.js';


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
/**
 * @param {RunnerPayload} payload
 */
export async function runConfigInBackground(payload) {
    const callback = payload.callback;

    /**
     * @type {string[]}
     */
    const fullLogData = [];
    let chunkedLogData = ['Running deployment script... Please wait...\n'];
    const startTime = Date.now();
    const write = new PassThrough();
    const delay = 5000;
    const headers = {
        'Content-Type': 'text/plain; charset=UTF-8',
    };
    /**
     * @type {import('https').RequestOptions}
     */
    const options = {
        rejectUnauthorized: false, // can be bad if I forgotten to renew
        family: 4, // some servers gateway ipv6 not working
        method: 'POST',
    };
    let aborted = false;
    const periodicSender = async () => {
        if (chunkedLogData.length > 0) {
            const data = normalizeShellOutput(chunkedLogData);
            chunkedLogData = ['[Chunked data...]\n'];
            request(callback, { data, headers, ...options })
                .then(e => {
                    console.log('callback response:', e.statusCode)
                    if (payload.sender && e.headers['content-type']?.includes('application/json') && typeof e.data?.payload == 'string') {
                        return payload.sender(e.data.payload)
                    }
                }).catch(e => {
                    console.error(e);
                });
        }
        if (write && !write.writableEnded) {
            setTimeout(periodicSender, delay).unref();
        }
    }
    if (callback) {
        periodicSender();
    }
    let lastWrite = Date.now();
    write.on('data', (chunk) => {
        if (!callback) return;
        chunk = chunk.toString();
        if (chunk.endsWith('\r') && Date.now() - lastWrite < 1000) {
            // only keep the last part.
            if (chunkedLogData.length > 1) {
                let lastLog = chunkedLogData.pop();
                if (lastLog) {
                    let nIndex = lastLog.lastIndexOf('\n');
                    if (nIndex > 0) {
                        chunkedLogData.push(lastLog.substring(0, nIndex));
                    }
                }
            }
            if (fullLogData.length > 1) {
                let lastLog = fullLogData.pop();
                if (lastLog) {
                    let nIndex = lastLog.lastIndexOf('\n');
                    if (nIndex > 0) {
                        fullLogData.push(lastLog.substring(0, nIndex));
                    }
                }
            }
        } else {
            lastWrite = Date.now();
        }
        chunkedLogData.push(chunk);
        fullLogData.push(chunk);
    });
    write.on('end', () => {
        if (!callback) return;
        chunkedLogData = [];
        const data = trimPayload(normalizeShellOutput(fullLogData));
        request(callback, { data, headers, ...options })
            .then(e => {
                console.log('callback response:', e.statusCode)
            }).catch(e => {
                console.error(e);
            });
    });
    try {
        payload.writer = (s) => {
            console.log('> ' + s);
            return writeAsync(write, s);
        }
        await runConfig(payload);
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
const getLoggerPath = () => path.join(__dirname, `../../logs/${new Date().toISOString().substring(0, 10)}.log`);
let loggerPath = getLoggerPath();
let childLogger = fs.openSync(loggerPath, 'a');
/**
 * 
 * @param {any} payload 
 * @returns 
 */
async function runConfigInBackgroundSingleton(payload) {
    const curLoggerPath = getLoggerPath();
    if (curLoggerPath != loggerPath) {
        loggerPath = curLoggerPath;
        // fs.closeSync(childLogger);
        childLogger = fs.openSync(curLoggerPath, 'a');
    }
    spawn('node', [path.join(process.cwd(), '/runner.js')], {
        stdio: ['ignore', childLogger, childLogger],
        detached: true,
        env: {
            RUNNER_PAYLOAD: JSON.stringify(payload),
        }
    }).unref();
}

/**
 * 
 * @param {any} payload 
 * @param {import('express').Response<any, Record<string, any>, number>} res 
 * @returns 
 */
async function runConfigInForeground(payload, res) {
    return new Promise((resolve, reject) => {
        let child = spawn('node', [path.join(process.cwd(), '/runner.js')], {
            stdio: 'pipe',
            env: {
                RUNNER_PAYLOAD: JSON.stringify(payload),
            }
        })


        // Collect stdout data
        child.stdout.on('data', (data) => {
            res.write(data.toString());
        });

        // Collect stderr data
        child.stderr.on('data', (data) => {
            res.write(data.toString());
        });

        // Handle process exit
        child.on('exit', (exitCode) => {
            res.write(`Process exited with code ${exitCode}\n`);
            res.end();
            if (exitCode !== 0) {
                reject();
            } else {
                resolve();
            }
        });

        // Handle spawn errors
        child.on('error', (error) => {
            reject(error);
        });
    })
}

export default function () {
    var router = express.Router();
    const runnerFn = function (/** @type {{ callback: string; sandbox: boolean; domain: string; body: any; res: any; }} */ opts) {
        const {
            body,
            domain,
            sandbox,
            callback,
            res,
        } = opts;
        if (/^https?:\/\/.+$/.test(callback)) {
            runConfigInBackgroundSingleton({
                body,
                domain,
                sandbox,
                callback,
            });
            res.send('OK');
        } else {
            runConfigInForeground({
                body,
                domain,
                sandbox,
            }, res);
        }
    }
    router.post('/cmd', checkGet(['user', 'cmd']), function (req, res, next) {
        const user = req.query.user.toString()
        const cmd = req.query.cmd.toString()
        const exc = spawnSudoUtil('SHELL_SUDO', [user, "bash", "-c", cmd]);
        exc.then((x) => res.send(x)).catch((err) => next(err))
    });
    router.post('/from-unix', checkGet(['user']), async function (req, res, next) {
        const user = req.query.user.toString()
        if (!/^\d+$/.test(user)) {
            next(new Error("user must be uid"));
            return;
        }
        const name = (await new Promise((resolve, reject) => exec("id -nu " + user, (err, stdout) => {
            (err ? reject : resolve)(stdout)
        }))).trim();
        const domain = (await virtualminExec.getDomainName(name))[0]
        
        res.write(`Running deployment for user ${name} (${user}) [${domain}]...\n`)
        const callback = req.header('x-callback');
        const sandbox = !!parseInt(req.query.sandbox?.toString() || '0');
        const body = req.body;
        runnerFn({ callback, sandbox, domain, body, res })
    });
    router.post('/', checkGet(['domain']), (req, res, next) => {
        const callback = req.header('x-callback');
        const sandbox = !!parseInt(req.query.sandbox?.toString() || '0');
        const domain = req.query.domain + "";
        const body = req.body;
        runnerFn({ callback, sandbox, domain, body, res })
    });
    return router;
}

