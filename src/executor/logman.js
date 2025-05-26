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
                return await spawnSudoUtil("SHELL_SUDO", ["root",
                    "tail", "-n", n + '', `${home}/logs/access_log`]);
            case 'error':
                return await spawnSudoUtil("SHELL_SUDO", ["root",
                    "tail", "-n", n + '', `${home}/logs/error_log`]);
            case 'php':
                return await spawnSudoUtil("SHELL_SUDO", ["root",
                    "tail", "-n", n + '', `${home}/logs/php_log`]);
            case 'proxfix':
                return await spawnSudoUtil("SHELL_SUDO", ["root",
                    "tail", "-n", n + '', `/home/${user}/tmp/app.log`]);
            case 'passenger':
                const procs = await this.getPassengerPids(user);
                if (procs.code !== 0) {
                    return procs;
                }
                let pids = Object.values(procs.stdout).flatMap(x => x).join('\\|');
                let pes = await spawnSudoUtil("PASSENGERLOG_GET", [pids, n + '']);
                if (pes.code == 0) {
                    // @ts-ignore
                    pes.processes = procs;
                }
                return pes;
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
        let pids = Object.values(procs.stdout).flatMap(x => x);
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
     * @returns {Promise<{ code: number, stderr: string, stdout: any, raw?: any }>}
     */
    async getPassengerPids(user, name = null) {
        let peo, pe;
        try {
            pe = process.env.NODE_ENV === 'development' ?
                { code: 0, stdout: await readFile(name ? './test/passenger-status' : './test/passenger-status-multi', { encoding: 'utf-8' }), stderr: '' } :
                await spawnSudoUtil("SHELL_SUDO", name ? [user,
                    "passenger-status", name, "--show=xml"] : [user,
                    "passenger-status", "--show=xml"]);
            peo = pe.stdout.trim();
        } catch (error) {
            if (typeof error.stdout === 'string') {
                if (error.stdout.startsWith('It appears that multiple Phusion Passenger(R) instances are running') && !name) {
                    var pids = error.stdout.match(/^\w{8}\b/gm)
                    var objs = {};
                    var code = 0;
                    for (const p of pids) {
                        const i = await this.getPassengerPids(user, p);
                        Object.assign(objs, i.stdout);
                        code = Math.max(code, i.code)
                    }
                    return {
                        code,
                        stderr: codeToErr[code] || '',
                        stdout: objs
                    }
                } else {
                    return error;
                }
            }
            return {
                code: 250,
                stderr: error,
                stdout: {},
            }
        }
        if (!peo) {
            return {
                code: 254,
                stderr: codeToErr[254],
                stdout: {},
                raw: pe,
            }
        }
        const parser = new XMLParser();
        let peom = parser.parse(peo);
        let peoma = peom?.info?.supergroups?.supergroup;
        if (!peoma) {
            return {
                code: 255,
                stderr: codeToErr[255],
                stdout: {}
            }
        }
        let peomaa = Array.isArray(peoma) ? peoma : [peoma];
        let peomaps = peomaa.map(x => x.group).filter(x => x.processes);
        if (!peomaps.length) {
            return {
                code: 253,
                stderr: codeToErr[253],
                stdout: {}
            }
        }
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
    253: 'No processes reported from passenger-status is running',
    254: 'No passenger app is found or it\'s not initialized yet',
    255: 'Incomplete response from passenger-status',
}

export const logmanExec = new LogmanExecutor();
