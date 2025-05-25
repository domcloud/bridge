#!/usr/bin/env node

import shelljs from 'shelljs'
import cli from 'cli'
import dotenv from 'dotenv'
import path from 'path';
import {
    chmodSync,
    chownSync,
    existsSync,
    statSync
} from 'fs';
import {
    fileURLToPath
} from 'url';
import {
    spawn
} from 'child_process';

const __dirname = path.dirname(fileURLToPath(
    import.meta.url));
dotenv.config({
    path: path.join(__dirname, './.env')
});

const {
    cat,
    cd,
    exec,
    mv,
    rm,
    exit,
    ls,
    ShellString,
} = shelljs;

const isDebian = existsSync('/etc/lsb-release');

const env = Object.assign({}, {
    BASH_PATH: '/bin/bash',
    BASH_SU: 'su',
    BASH_SUDO: 'sudo',
    BASH_KILL: 'kill',
    VIRTUAL_SERVER_PATH: '/etc/webmin/virtual-server/domains/$',
    VIRTUAL_SERVER_OUT: '/etc/webmin/virtual-server/domains/$',
    VIRTUAL_SERVER_TMP: path.join(__dirname, '.tmp/virtual-server'),
    NGINX_PATH: isDebian ? '/etc/nginx/sites-available/$.conf' : '/etc/nginx/conf.d/$.conf',
    NGINX_OUT: isDebian ? '/etc/nginx/sites-available/$.conf' : '/etc/nginx/conf.d/$.conf',
    NGINX_BIN: 'nginx',
    NGINX_START: 'systemctl start nginx',
    NGINX_TMP: path.join(__dirname, '.tmp/nginx'),
    UNIT_SOCKET: '/var/run/unit/control.sock',
    UNIT_TMP: path.join(__dirname, '.tmp/unit'),
    COMPOSE_TMP: path.join(__dirname, '.tmp/compose'),
    NFTABLES_PATH: '/etc/nftables-firewall.conf',
    NFTABLES_OUT: '/etc/nftables-firewall.conf',
    NFTABLES_LOAD: 'nft',
    NFTABLES_TMP: path.join(__dirname, '.tmp/nftables'),
    PASSENGERLOG_PATH: '/var/log/nginx/passenger.log',
    NAMED_PATHS: '/var/named/$.hosts',
    NAMED_OUT: '/var/named/$.hosts',
    NAMED_CHECK: 'named-checkzone',
    NAMED_RELOAD: 'rndc reload $',
    NAMED_RESYNC: 'rndc retransfer $',
    NAMED_TMP: path.join(__dirname, '.tmp/named'),
    OPENSSL_PATH: isDebian ? '/usr/lib/ssl/openssl.cnf' : '/etc/pki/tls/openssl.cnf',
    OPENSSL_OUT: isDebian ? '/usr/lib/ssl/openssl.cnf' : '/etc/pki/tls/openssl.cnf',
    PORTS_PATH: '/etc/ports',
    PORTS_OUT: '/etc/ports',
    PORTS_TMP: path.join(__dirname, '.tmp/ports'),
    VIRTUALMIN: 'virtualmin',
    LOGINLINGERDIR: '/var/lib/systemd/linger',
    REDIS_ACLMAP: '/etc/valkey/usermap.acl',
    REDIS_ACLTMP: path.join(__dirname, '.tmp/redis-acl'),
    PHPFPM_REMILIST: isDebian ? '/etc/php/' : '/etc/opt/remi/',
    PHPFPM_REMICONF: isDebian ? '/etc/php/$/fpm/pool.d' : '/etc/opt/remi/$/php-fpm.d',
    PHPFPM_REMILOC: isDebian ? '/usr/sbin/php-fpm$' : '/opt/remi/$/root/usr/sbin/php-fpm',
    OPCACHE_TMP: path.join(__dirname, '.tmp/opcache'),
    SHELLCHECK_TMP: path.join(__dirname, '.tmp/check'),
    SHELLTEST_TMP: path.join(__dirname, '.tmp/test'),
    SSL_WILDCARDS_TMP: path.join(__dirname, '.tmp/wildcardssl.json'),
    SCRIPT: path.join(__dirname, 'sudoutil.js'),
}, process.env);

/**
 * @param {import("fs").PathLike} filePath
 */
function fixOwner(filePath) {
    const {
        uid,
        gid
    } = statSync(path.join(__dirname, './sudoutil.js'));
    chownSync(filePath, uid, gid);
    chmodSync(filePath, 0o750);
}

function getFpmList() {
    return ls(env.PHPFPM_REMILIST).filter((f) => f.match(isDebian ? /\d\.\d/ : /php\d\d/));
}

function isDfFull(/** @type {string} */ df, /** @type {number} */ limit) {
    var r = /([\d\.]+[GMK]?)\s+\d+% +(.+)/g;
    var m;
    while (m = r.exec(df)) {
        if (!m) return false;
        if ((m[2] || '').startsWith('/boot')) continue;
        let bytes_str = m[1];
        if (bytes_str.match(/^\d+$/)) {
            bytes_str += "B";
        }
        var size = parseFloat(m[1].slice(0, -1));
        var unit = m[1].slice(-1);
        size = size * {
            T: 1024 * 1024,
            G: 1024,
            M: 1,
            K: 1 / 1024,
            B: 1 / (1024 * 1024),
        }[unit];
        if (size < limit) {
            return true;
        }
    }
    return false;
}

cd(__dirname); // making sure because we're in sudo
let arg;
switch (cli.args.shift()) {
    case 'NGINX_GET':
        arg = cli.args.shift();
        const ngpath = env.NGINX_PATH.replace('$', arg);
        if (existsSync(ngpath)) {
            cat(ngpath).to(env.NGINX_TMP);
        } else if (existsSync(ngpath + '.bak')) {
            ShellString("# Restored from .bak file, meaning this site was disabled due to NGINX bug\n\n").to(env.NGINX_TMP);
            cat(ngpath + '.bak').toEnd(env.NGINX_TMP);
        } else {
            // TODO: doesn't know what would it get if not exists
            cat(ngpath).to(env.NGINX_TMP);
        }
        fixOwner(env.NGINX_TMP);
        exit(0);
    case 'NGINX_SET':
        arg = cli.args.shift();
        let DEST = env.NGINX_OUT.replace('$', arg);
        mv(DEST, DEST + '.bak');
        cat(env.NGINX_TMP).to(DEST);
        if (exec(`${env.NGINX_BIN} -t`).code !== 0) {
            rm(DEST);
            mv(DEST + '.bak', DEST);
            exit(1);
        }
        rm(DEST + '.bak');
        exec(`${env.NGINX_BIN} -s reload`);
        exit(0);
    case 'PASSENGERLOG_GET':
        arg = cli.args.shift();
        var n = parseInt(cli.args.shift());
        console.log(exec(`grep -w "\\(^App\\|process\\) \\(${arg}\\)" "${env.PASSENGERLOG_PATH}"`).tail({ '-n': n }).stdout);
        exit(0);
    case 'COMPOSE_GET':
        arg = cli.args.shift();
        cat(arg).to(env.COMPOSE_TMP);
        fixOwner(env.COMPOSE_TMP);
        exit(0);
    case 'COMPOSE_SET':
        arg = cli.args.shift();
        cat(env.COMPOSE_TMP).to(arg);
        exit(0);
    case 'UNIT_GET':
        arg = cli.args.shift();
        var unit = spawn('curl', ['--unix-socket', env.UNIT_SOCKET, 'http://localhost' + arg], {
            stdio: 'inherit',
        });
        unit.on('close', function (code) {
            exit(code);
        });
        setTimeout(() => {
            // just in case
            if (!unit.killed)
                unit.kill();
        }, 1000 * 60).unref();
        break;
    case 'UNIT_SET':
        arg = cli.args.shift();
        unit = spawn('curl', ['-X', 'PUT',
            '--data-binary', '@' + env.UNIT_TMP, '--unix-socket',
            env.UNIT_SOCKET, 'http://localhost' + arg], {
            stdio: 'inherit',
        });
        unit.on('close', function (code) {
            exit(code);
        });
        setTimeout(() => {
            // just in case
            if (!unit.killed)
                unit.kill();
        }, 1000 * 600).unref();
        break;
    case 'UNIT_DEL':
        arg = cli.args.shift();
        unit = spawn('curl', ['-X', 'DELETE', '--unix-socket',
            env.UNIT_SOCKET, 'http://localhost' + arg], {
            stdio: 'inherit',
        });
        unit.on('close', function (code) {
            exit(code);
        });
        setTimeout(() => {
            // just in case
            if (!unit.killed)
                unit.kill();
        }, 1000 * 600).unref();
        break;
    case 'VIRTUAL_SERVER_GET':
        arg = cli.args.shift();
        cat(env.VIRTUAL_SERVER_PATH.replace('$', arg)).to(env.VIRTUAL_SERVER_TMP);
        fixOwner(env.VIRTUAL_SERVER_TMP);
        exit(0);
    case 'VIRTUAL_SERVER_SET':
        arg = cli.args.shift();
        cat(env.VIRTUAL_SERVER_TMP).to(env.VIRTUAL_SERVER_OUT.replace('$', arg));
        exit(0);
    case 'REDIS_GETUSER':
        arg = cli.args.shift();
        console.log(cat(env.REDIS_ACLMAP).grep('^' + arg + ':').toString());
        exit(0);
    case 'REDIS_GET':
        arg = cli.args.shift();
        cat(env.REDIS_ACLMAP).to(env.REDIS_ACLTMP);
        fixOwner(env.REDIS_ACLTMP);
        exit(0);
    case 'REDIS_SET':
        cat(env.REDIS_ACLTMP).to(env.REDIS_ACLMAP);
        exit(0);
    case 'PORTS_LIST':
        arg = cli.args.shift();
        console.log(cat(env.PORTS_PATH).toString());
        exit(0);
    case 'PORTS_GET':
        arg = cli.args.shift();
        cat(env.PORTS_PATH).to(env.PORTS_TMP);
        fixOwner(env.PORTS_TMP);
        exit(0);
    case 'PORTS_SET':
        cat(env.PORTS_TMP).to(env.PORTS_OUT);
        exit(0);
    case 'PORTS_PRUNE':
        arg = cli.args.shift();
        cat(env.PORTS_PATH).grep('-v', '^' + arg + ':').to(env.PORTS_OUT);
        exit(0);
    case 'NGINX_START':
        exec(env.NGINX_START);
        exit(0);
    case 'FIREWALL_GET':
        cat(env.NFTABLES_PATH).to(env.NFTABLES_TMP);
        fixOwner(env.NFTABLES_TMP);
        exit(0);
    case 'FIREWALL_SET':
        if (exec(`${env.NFTABLES_LOAD} -f ${env.NFTABLES_TMP} --check`).code !== 0)
            exit(1);
        cat(env.NFTABLES_TMP).to(env.NFTABLES_OUT);
        exec(`${env.NFTABLES_LOAD} -f ${env.NFTABLES_OUT}`);
        exit(0);
    case 'NAMED_GET':
        arg = cli.args.shift();
        cat(env.NAMED_PATHS.replace('$', arg)).to(env.NAMED_TMP);
        fixOwner(env.NAMED_TMP);
        exit(0);
    case 'NAMED_SET':
        arg = cli.args.shift();
        if (exec(`${env.NAMED_CHECK} ${arg} ${env.NAMED_TMP}`).code !== 0)
            exit(1);
        cat(env.NAMED_TMP).to(env.NAMED_OUT.replace('$', arg));
        exit(exec(env.NAMED_RELOAD.replace('$', arg)).code);
    case 'NAMED_SYNC':
        arg = cli.args.shift();
        exit(exec(env.NAMED_RESYNC.replace('$', arg)).code);
    case 'VIRTUALMIN':
        arg = cli.args.join(' ');
        exit(exec(env.VIRTUALMIN + " " + arg).code);
    case 'OPENSSL_CLEAN':
        var cnf = cat(env.OPENSSL_PATH).toString();
        cnf = cnf.replace(/^subjectAltName=DNS.+\n/gm, '');
        ShellString(cnf).to(env.OPENSSL_OUT);
        exit(0);
    case 'OPCACHE_STATUS_HTML':
        arg = cli.args.shift();
        var query = cli.args.shift();
        if (!/^(php\d\d|\d\.\d)$/.test(arg)) {
            exit(1);
        }
        const thefile = '/usr/local/share/www/opcache.php';
        const thesock = isDebian ? `/run/php/php${arg}-fpm.sock` : `/var/opt/remi/${arg}/run/php-fpm/www.sock`;
        const theout = exec(`QUERY_STRING="${query}" SCRIPT_FILENAME=${thefile} REQUEST_METHOD=GET cgi-fcgi -bind -connect ${thesock} | tail -n +4`);
        ShellString(theout.stdout).to(env.OPCACHE_TMP);
        exit(0);
    case 'CLEAN_DOMAIN':
        if (cli.args.length < 3) {
            console.error("CLEAN_DOMAIN [rm|mv] [id] [domain]");
            exit(1);
        }
        const mode = cli.args.shift();
        const id = cli.args.shift();
        const domain = cli.args.shift();
        var fpmlist = getFpmList();
        var fpmcleaned = '', nginxcleaned = '';
        /**
         * @param {string} p
         */
        function cleanfile(p) {
            if (mode == "rm") {
                rm(p);
            } else {
                mv(p, p + ".bak");
            }
        }
        if (id) {
            for (const f of fpmlist) {
                var p = `${env.PHPFPM_REMICONF.replace('$', f)}/${id}.conf`;
                if (existsSync(p)) {
                    cleanfile(p);
                    fpmcleaned = f;
                    break;
                }
            }
        }
        if (domain) {
            var p = env.NGINX_PATH.replace('$', domain);
            if (existsSync(p)) {
                cleanfile(p);
                nginxcleaned = '1';
            }
        }
        if (fpmcleaned) {
            exec(`systemctl restart ${isDebian ? `php${fpmcleaned}-fpm` : `${fpmcleaned}-php-fpm`}`)
        }
        if (nginxcleaned) {
            exec(`${env.NGINX_BIN} -s reload`);
        }
        exit(0);
    case 'SHELL_KILL':
        arg = cli.args.shift();
        exec(`${env.BASH_KILL} ${arg}`, { shell: '' }).code;
        exit(0);
    case 'SHELL_EXISTS':
        arg = cli.args.shift();
        for (const path of cli.args) {
            if (!existsSync(path)) {
                exit(1);
            }
        }
        exit(0);
    case 'SHELL_SUDO':
        arg = cli.args.shift();
        var sudo = spawn(env.BASH_SUDO, ['-u', arg, '-i', ...cli.args], {
            stdio: 'inherit'
        });
        sudo.on('close', function (code) {
            exit(code);
        });
        setTimeout(() => {
            // just in case
            if (!sudo.killed)
                sudo.kill();
        }, 1000 * 60).unref();
        break;
    case 'SHELL_INTERACTIVE':
        arg = cli.args.shift();
        var su = spawn("machinectl", ['-q', 'shell', arg + '@'], {
            stdio: 'inherit'
        });
        su.on('close', function (code) {
            exit(code);
        });
        setTimeout(() => {
            // just in case
            if (!su.killed)
                su.kill();
        }, 1000 * 60 * 60).unref();
        break;
    case 'SHELL_CHECK':
        var fpmlist = getFpmList();
        var services = [
            'nginx',
            ...fpmlist.map((f) => isDebian ? `php${f}-fpm` : `${f}-php-fpm`),
            'named',
            'webmin',
            'sshd',
            isDebian ? 'cron' : 'crond',
            'mariadb',
            'postgresql',
            'valkey',
            'nftables',
            'fail2ban',
            'earlyoom',
        ]
        var statutes = exec(`systemctl is-failed ${services.join(' ')}`, { silent: true }).split('\n').filter((s) => s !== '');
        var storagec = exec(`df -h | grep ^/dev`, { silent: true });
        var storagefull = isDfFull(storagec, 100);
        var exitcode = 0;
        if (statutes.some((s) => s !== 'active') || storagefull)
            exitcode = 1;
        ShellString(JSON.stringify({
            status: exitcode === 0 ? 'OK' : 'ERROR',
            statuses: Object.fromEntries(services.map((k, i) => [k, statutes[i]])),
            storagefull,
            timestamp: Date.now(),
        })).to(env.SHELLCHECK_TMP);
        exit(0);
    case 'SHELL_TEST':
        var nginx = exec(`${env.NGINX_BIN} -t`, { silent: true });
        var fpmlist = getFpmList();
        var fpmpaths = fpmlist.map((f) => env.PHPFPM_REMILOC.replace('$', f));
        var fpms = fpmpaths.map((f) => exec(`${f} -t`, { silent: true }));
        var storage = exec(`df -h | grep ^/dev`, { silent: true });
        var quota = exec(`findmnt -r | grep -P '(/ |/home )'`, { silent: true }).stdout.trim().split('\n');
        var named = exec(`named-checkconf -z /etc/named.conf`, { silent: true });
        var storagefull = isDfFull(storage.stdout, 5 * 1024);
        var quotaOK = quota.every(x => x.includes('usrquota') && x.includes('grpquota'));
        var chkmem = exec(`free -h`, { silent: true });
        var chkcpu = exec(`uptime`, { silent: true });

        var exitcode = 0;
        if (nginx.code !== 0 || fpms.some((f) => f.code !== 0) || storagefull || !quotaOK || named.code !== 0)
            exitcode = 1;
        var sslcode = undefined, ssldata = undefined;
        if (existsSync(env.SSL_WILDCARDS_TMP) && (ssldata = JSON.parse(cat(env.SSL_WILDCARDS_TMP).toString()))) {
            sslcode = Object.values(ssldata).every(el => {
                var combinedPath = path.join(el.path, 'ssl.combined');
                if (!existsSync(combinedPath)) return false;
                var combinedContent = cat(combinedPath).toString();
                return (combinedContent.match(/BEGIN CERTIFICATE/g) || []).length > 1
            }) ? 0 : 1;
            if (sslcode !== 0) {
                exitcode = 1
            }
        }
        ShellString(JSON.stringify({
            status: exitcode === 0 ? 'OK' : 'ERROR',
            codes: {
                nginx: nginx.code,
                fpms: fpms.map((f) => f.code),
                storage: storagefull ? 1 : 0,
                named: named.code,
                quota: quotaOK ? 0 : 1,
                ssl: sslcode,
            },
            logs: {
                cpuinfo: chkcpu.stdout.trimEnd().split('\n'),
                meminfo: chkmem.stdout.trimEnd().split('\n'),
                storage: storage.stdout.trimEnd().split('\n'),
                quota,
                nginx: nginx.stderr.trimEnd().split('\n'),
                named: named.grep('bad zone').trimEnd().split('\n'),
                fpms: Object.fromEntries(fpmlist.map((_, i) => [fpmlist[i], fpms[i].stderr.trimEnd().split('\n').filter(x => !x.includes('test is successful'))])),
            },
            timestamp: Date.now(),
        })).to(env.SHELLTEST_TMP);
        exit(0);
    default:
        console.error(`Unknown Mode`);
        exit(1);
}