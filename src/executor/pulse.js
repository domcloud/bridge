import { spawnSudoUtil } from "../util.js";

export async function fixPHP(test) {
    for (const [name, logs] of Object.entries(test.logs.fpms)) {
        const [lastLog] = logs.splice(logs.length - 1);
        if (lastLog.endsWith("ERROR: FPM initialization failed")) {
            for (const element of logs) {
                let m = element.match(/\[pool (\d+)\] cannot get uid for user '(.+)'/);
                if (m) {
                    await spawnSudoUtil("CLEAN_DOMAIN", ["mv", m[1], ""]);
                }
            }
        }
    }
}

export async function fixNGINX(test) {
    const logs = test.logs.nginx;
    const [lastLog] = logs.splice(logs.length - 1);
    if (lastLog == "nginx: configuration file /etc/nginx/nginx.conf test failed") {
        for (const element of logs) {
            let m = element.match(/nginx: \[emerg\] cannot load certificate \"([\w.\/]+)\"/);
            if (m) {
                let find = (await spawnSudoUtil("SHELL_SUDO", [
                    "root", "grep", "-lr", m[1], "/etc/nginx/conf.d"
                ])).stdout.trim().split("\n");
                for (const f of find) {
                    let m2 = f.match(/\/etc\/nginx\/conf.d\/(.+)\.conf/);
                    if (m2) {
                        await spawnSudoUtil("CLEAN_DOMAIN", ["mv", "", m2[1]]);
                    }
                }
            }
        }
    }
}

