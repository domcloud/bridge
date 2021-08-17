import shell, {
    cat,
    cd,
    exec,
    exit,
} from 'shelljs'
import cli from 'cli'
import dotenv from 'dotenv'
import path from 'path';
import { error } from 'console';

dotenv.config();

const env = Object.assign({}, {
    NGINX_PATH: '/etc/nginx/nginx.conf',
    NGINX_BIN: 'nginx',
    NGINX_TMP: path.join(__dirname, '.tmp/nginx'),
    IPTABLES_SAVE: 'iptables-save',
    IPTABLES_LOAD: 'iptables-restore',
    IP6TABLES_SAVE: 'ip6tables-save',
    IP6TABLES_LOAD: 'ip6tables-restore',
    IPTABLES_TMP: path.join(__dirname, '.tmp/iptables'),
    IP6TABLES_TMP: path.join(__dirname, '.tmp/ip6tables'),
    NAMED_HOSTS: '/var/named/$.hosts',
    NAMED_CHECK: 'named-checkzone',
    NAMED_RELOAD: 'rndc reload $',
    NAMED_RESYNC: 'rndc retransfer $',
    NAMED_TMP: path.join(__dirname, '.tmp/named'),
    VIRTUALMIN: 'virtualmin',
}, process.env);

cd(__dirname); // making sure because we're in sudo
switch (cli.args.shift()) {
    case 'NGINX_GET':
        cat(env.NGINX_PATH).to('.tmp/nginx');
        exit(0);
    case 'NGINX_SET':
        if (exec(`${env.NGINX_BIN} -t -c '${env.NGINX_TMP}'`).code !== 0)
            exit(1);
        cat(env.NGINX_TMP).to(env.NGINX_PATH);
        exec(`${env.NGINX_BIN} -s reload`);
        exit(0);
    case 'IPTABLES_GET':
        exec(env.IPTABLES_SAVE).to(env.IPTABLES_TMP);
        exec(env.IP6TABLES_SAVE).to(env.IP6TABLES_TMP);
        exit(0);
    case 'IPTABLES_SET':
        if (cat(env.IPTABLES_TMP).exec(env.IPTABLES_LOAD).code !== 0)
            exit(1);
        if (cat(env.IP6TABLES_TMP).exec(env.IP6TABLES_LOAD).code !== 0)
            exit(1);
        exit(0);
    case 'NAMED_GET':
        let arg = cli.args.shift();
        cat(env.NAMED_HOSTS.replace('$', arg)).to(env.NAMED_TMP);
        exit(0);
    case 'NAMED_SET':
        arg = cli.args.shift();
        if (exec(`${env.NAMED_CHECK} ${arg} ${env.NAMED_TMP}`).code !== 0)
            exit(1);
        cat(env.NAMED_TMP).to(env.NAMED_HOSTS.replace('$', arg));
        exit(exec(env.NAMED_RELOAD.replace('$', arg)).code);
    case 'NAMED_SYNC':
        arg = cli.args.shift();
        exit(exec(env.NAMED_RESYNC.replace('$', arg)).code);
    case 'VIRTUALMIN':
        arg = cli.args.join(' ');
        exit(exec(env.VIRTUALMIN + " " + arg).code);
    default:
        error(`Unknown Mode`);
        exit(1);
}