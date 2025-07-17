import {
    cat,
    executeLock,
    spawnSudoUtil,
    writeTo
} from '../util.js';
import { XMLParser } from "fast-xml-parser";
import { readFile } from "fs/promises";

class LogmanExecutor {
    constructor() {
    }
    /**
     * @param {string} user
     * @param {string} type
     * @param {string} sub
     * @param {number} n
     */
    async getLog(user, type, sub, n) {
        let home = `/home/${user}`;
        if (sub) {
            home += `/domains/${sub}`
        }
        switch (type) {
            case 'access':
                return await spawnSudoUtil("SHELL_SUDO", ["nginx",
                    "tail", "-n", n + '', `/var/log/virtualmin/${sub}_access_log`]);
            case 'error':
                return await spawnSudoUtil("SHELL_SUDO", ["nginx",
                    "tail", "-n", n + '', `/var/log/virtualmin/${sub}_error_log`]);
            case 'php':
                return await spawnSudoUtil("SHELL_SUDO", [user,
                    "tail", "-n", n + '', `${home}/logs/php_log`]);
            case 'proxfix':
                return await spawnSudoUtil("SHELL_SUDO", [user,
                    "tail", "-n", n + '', `/home/${user}/tmp/app.log`]);
            case 'passenger':
                const procs = await this.getPassengerPids(user);
                if (procs.code !== 0) {
                    return procs;
                }
                let pids = Object.values(procs.stdout).flatMap(x => x).join('\\|');
                let pes = await spawnSudoUtil("PASSENGERLOG_GET", [pids, n + '']);
                return { ...pes, processes: procs.stdout };
            default:
                return {
                    code: 255,
                    stderr: 'Unknown log type ' + type,
                    stdout: '',
                }
        }
    }
    /**
     * @param {any} domain
     */
    async restartPassenger(domain) {
        const user = domain['Username'];
        const procs = await this.getPassengerPids(user);
        if (procs.code !== 0) {
            return procs.stderr;
        }
        let pids = Object.values(procs.stdout).flatMap(x => x).map(x => x.toString());
        if (pids) {
            await spawnSudoUtil("SHELL_SUDO", ["root",
                "kill", "-9", ...pids
            ]);
            return "Sent SIGKILL to processes " + pids;
        }
        return "No processes currently running.";
    }
    /**
     * @param {string} user
     * @param {string} name
     * @returns {Promise<{ code: number, stderr: string, stdout: Record<string, number[]>}>}
     */
    async getPassengerPids(user, name = null) {
        let pe;
        try {
            pe = process.env.NODE_ENV === 'development' ?
                { code: 0, stdout: await readFile(name ? './test/passenger-status' : './test/passenger-status-multi', { encoding: 'utf-8' }), stderr: '' } :
                await spawnSudoUtil("SHELL_SUDO", name ? [user,
                    "passenger-status", name, "--show=xml"] : [user,
                    "passenger-status", "--show=xml"]);
        } catch (error) {
            // non zero exit code
            if (typeof error.stdout === 'string') {
                if (error.stdout.startsWith('It appears that multiple Phusion Passenger(R) instances are running') && !name) {
                    var pids = error.stdout.match(/^\w{8}\b/gm)
                    /**
                     * @type {Record<string, number[]>}
                     */
                    var objs = {};
                    var errs = [];
                    var code = 0;
                    for (const p of pids) {
                        const i = await this.getPassengerPids(user, p);
                        Object.assign(objs, i.stdout);
                        code = Math.max(code, i.code);
                        if (i.code !== 0) {
                            errs.push(i.stderr.trim());
                        }
                    }
                    if (Object.keys(objs).length > 0) {
                        return {
                            code: 0,
                            stderr: '',
                            stdout: objs
                        }
                    } else {
                        return {
                            code,
                            stderr: codeToErr[code] || errs.join('\n'),
                            stdout: objs
                        }
                    }
                } else if (!error.stdout && error.code < 127) {
                    // something like "500 Internal Server Error" and not bash error
                    return {
                        code: 254,
                        stderr: codeToErr[254],
                        stdout: {},
                    }
                } else {
                    // need to report process error
                    return error;
                }
            }
            return {
                // not process error
                code: 250,
                stderr: codeToErr[250] + error.toString(),
                stdout: {},
            }
        }
        const peout = pe.stdout.trim();
        const parser = new XMLParser();
        let peom = parser.parse(peout);
        let peoma = peom?.info?.supergroups?.supergroup;
        if (!peoma) {
            // Phusion Passenger(R) is currently not serving any applications
            return {
                code: 255,
                stderr: codeToErr[255],
                stdout: {}
            }
        }
        let peomaa = Array.isArray(peoma) ? peoma : [peoma];
        let peomaps = peomaa.map(x => x.group).filter(x => x.processes);
        /**
         * @type {Record<string, number[]>}
         */
        let procs = peomaps.reduce((a, b) => {
            let x = (Array.isArray(b.processes.process) ? b.processes.process : [b.processes.process]);
            a[b.name] = x.map(y => y.pid).filter(y => typeof y === "number");
            return a;
        }, {});
        return {
            code: 0,
            stderr: '',
            stdout: procs
        };
    }
}

const codeToErr = {
    250: 'Application error: ',
    254: 'Got incomplete response from passenger-status',
    255: 'No processes were reported by passenger-status',
}

export const logmanExec = new LogmanExecutor();
