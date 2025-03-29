import { countOf, getJavaVersion, getPythonVersion, getRubyVersion, isDebian, nthIndexOf } from "../util.js";
import { dockerExec } from "./docker.js";
import { logmanExec } from "./logman.js";

/**
 * @param {string} key
 * @param {string} value
 * @param {{ (s: string): Promise<void>; (arg0: string): any; }} writeLog
 * @param {{ [x: string]: string; }} domaindata
 * @param {{ (cmd: string, write?: boolean): Promise<any>; (arg0: string, arg1: boolean): any; }} sshExec
 */
export async function runConfigCodeFeatures(key, value, writeLog, domaindata, sshExec) {
    let arg;
    switch (key) {
        case 'restart':
            await writeLog("$> Restarting passenger processes");
            await writeLog(await logmanExec.restartPassenger(domaindata));
            break;
        case 'yum':
        case 'dnf':
            await writeLog("$> Setting up environment for yum installation");
            await sshExec(`sed -i '\\|~/usr/lib64/|d' ~/.bashrc`, false);
            await sshExec(`pathman add ~/usr/bin`);
            await sshExec(`echo "export LD_LIBRARY_PATH=~/usr/lib64/:$LD_LIBRARY_PATH" >> ~/.bashrc`)
            await sshExec(`DNFDIR="/var/tmp/dnf-$USER-dwnlddir"`, false);
            await sshExec(`[ ! -d $DNFDIR ] && { cp -r /var/cache/dnf $DNFDIR ; chmod -R 0700 $DNFDIR ; }`, false);
            if (value != "") {
                await writeLog("$> Installing packages via yum");
                await sshExec(`mkdir -p ~/Downloads`, false);
                await sshExec(`dnf download ${value} --destdir ~/Downloads --resolve -y`);
                await sshExec(`ls ~/Downloads/*.rpm | xargs -n 1 -I {} sh -c 'rpm2cpio "{}" | cpio -idmD ~'`);
            }
            await sshExec(`. ~/.bashrc`, false)
            break;
        case 'docker':
            if (value === '' || value === 'on') {
                await writeLog("$> Enabling docker features");
                await writeLog(await dockerExec.enableDocker(domaindata['Username']));
                await sshExec(`sed -i '/DOCKER_HOST=/d' ~/.bashrc`, false);
                await sshExec(`echo "export DOCKER_HOST=unix:///run/user/$(id -u)/docker.sock" >>  ~/.bashrc;`);
                await sshExec(`mkdir -p ~/.config/docker  ~/.config/systemd/user/docker.service.d`, false);
                await sshExec(`printf '{\\n\\t"exec-opts": ["native.cgroupdriver=cgroupfs"]\\n}\\n' > ~/.config/docker/daemon.json`);
                await sshExec(`printf '[Service]\\nEnvironment="DOCKERD_ROOTLESS_ROOTLESSKIT_NET=pasta"\\nEnvironment="DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER=implicit"\\n' > ~/.config/systemd/user/docker.service.d/override.conf`);
                await sshExec(`dockerd-rootless-setuptool.sh install --skip-iptables`);
                await sshExec(`export DOCKER_HOST=unix:///run/user/$(id -u)/docker.sock`, false);
            } else if (value === 'off') {
                await writeLog("$> Disabling docker features");
                await sshExec(`dockerd-rootless-setuptool.sh uninstall --skip-iptables`);
                await sshExec(`sed -i '/DOCKER_HOST=/d' ~/.bashrc`);
                await sshExec(`rm -rf ~/.config/docker`);
                await sshExec(`rootlesskit rm -rf ~/.local/share/docker`);
                await writeLog(await dockerExec.disableDocker(domaindata['Username']));
            }
            break;
        case 'python':
            if (value == 'off') {
                await writeLog("$> Removing Python engine");
                await sshExec("rm -rf ~/.pyenv");
                await sshExec("sed -i '/pyenv/d' ~/.bashrc");
            } else {
                const parg = getPythonVersion(value);
                await writeLog("$> Changing Python engine to " + parg.version);
                await sshExec("command -v pyenv &> /dev/null || (curl -sS https://webinstall.dev/pyenv | bash); source ~/.config/envman/PATH.env");
                if (parg.binary) {
                    await sshExec(`mkdir -p ~/.pyenv/versions/${parg.version}`);
                    await sshExec(`curl -sSL "${parg.binary}" | tar --zstd -axf - -C ~/tmp`);
                    await sshExec(`mv ~/tmp/python/install/* ~/.pyenv/versions/${parg.version} || true ; rm -rf ~/tmp/python`);
                    await sshExec(`echo "export LD_LIBRARY_PATH=~/.pyenv/versions/${parg.version}:$LD_LIBRARY_PATH" >> ~/.bashrc`) // fix venv
                } else if (parg.version !== "system") {
                    await sshExec(`pyenv install ${parg.version} -s`);
                }
                await sshExec(`pyenv global ${parg.version.replace(":latest", "")}`);
                await sshExec(`source ~/.bashrc`, false)
                await sshExec("python --version");
            }
            break;
        case 'node':
            arg = value;
            if (arg == 'off') {
                await writeLog("$> Removing Node engine");
                await sshExec("rm -rf ~/.local/opt/node-* ~/.local/opt/node ~/Downloads/webi/node");
                await sshExec("rm -rf ~/.cache/yarn ~/.cache/node ~/.config/yarn ~/.npm ~/.nvm");
                await sshExec("pathman remove .local/opt/node/bin");
            } else {
                if (value == "latest" || value == "current") {
                    arg = "node";
                } else if (!value || value == "stable" || value == "lts") {
                    arg = "lts/*";
                } else {
                    arg = value;
                }
                await writeLog("$> Changing Node engine to " + (value || 'lts'));
                const nvmPath = `https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh`;
                await sshExec(`command -v nvm &> /dev/null || (curl -o- ${nvmPath} | bash) && source ~/.bashrc`);
                await sshExec(`nvm install ${arg} -b && nvm use ${arg} && nvm alias default ${arg}`);
                await sshExec("command -v corepack &> /dev/null || npm i -g corepack && corepack enable");
                await sshExec(`[[ -z $COREPACK_ENABLE_AUTO_PIN ]] && echo "export COREPACK_ENABLE_AUTO_PIN=0" >> ~/.bashrc`)
                await sshExec("source ~/.bashrc", false);
                await sshExec("node --version");
            }
            break;
        case 'deno':
            arg = value;
            if (arg == 'off') {
                await writeLog("$> Removing Deno engine");
                await sshExec("rm -rf ~/.local/opt/deno-* ~/.deno ~/.local/bin/deno ~/Downloads/webi/deno");
                await sshExec("pathman remove ~/.deno/bin/");
            } else {
                if (value == "latest" || value == "current") {
                    arg = "";
                } else if (!value || value == "lts") {
                    arg = "@stable";
                } else {
                    arg = "@" + value;
                }
                await writeLog("$> Changing Deno engine to " + (value || 'stable'));
                await sshExec(`curl -sS https://webinstall.dev/deno${arg} | bash`);
                await sshExec("mkdir -p ~/.deno/bin/ && pathman add ~/.deno/bin/");
                await sshExec("source ~/.bashrc", false);
                await sshExec("deno --version");
            }
            break;
        case 'go':
        case 'golang':
            arg = value;
            if (arg == 'off') {
                await writeLog("$> Removing Golang engine");
                await sshExec("chmod -R 0700 ~/.local/opt/go-*");
                await sshExec("rm -rf ~/.local/opt/go-* ~/.cache/go-build ~/.local/opt/go ~/go ~/Downloads/webi/golang");
            } else {
                if (value == "latest" || value == "current") {
                    arg = "";
                } else if (!value || value == "lts") {
                    arg = "@stable";
                } else {
                    arg = "@" + value;
                }
                await writeLog("$> Changing Golang engine to " + (value || 'stable'));
                await sshExec(`curl -sS https://webinstall.dev/golang${arg} | WEBI__GO_ESSENTIALS=true bash ; source ~/.config/envman/PATH.env`);
                await sshExec("go version");
            }
            break;
        case 'rust':
        case 'rustlang':
            arg = value;
            if (arg == 'off') {
                await writeLog("$> Removing Rust engine");
                await sshExec("rustup self uninstall -y");
                await sshExec(`pathman remove $HOME/.cargo/bin`);
            } else {
                await writeLog(arg ? "$> Changing Rust engine to " + arg : "$> installing Rust engine");
                await sshExec(`command -v rustup &> /dev/null || (curl https://sh.rustup.rs -sSf | sh -s -- -y --default-toolchain none)`);
                await sshExec(`pathman add $HOME/.cargo/bin ; source ~/.config/envman/PATH.env`);
                if (!arg || ["current", "latest", "lts"].includes(arg)) {
                    arg = "stable"
                }
                await sshExec(`rustup toolchain install ${arg} --profile minimal && rustup default ${arg}`);
                await sshExec("rustc --version");
            }
            break;
        case 'ruby':
            if (value == 'off') {
                await writeLog("$> Removing Ruby engine");
                await sshExec(`rm -rf ~/.rvm`);
                await sshExec("sed -i '/rvm\\|RVM/d' ~/.bashrc");
            } else {
                const rarg = getRubyVersion(value);
                await writeLog("$> Changing Ruby engine to " + rarg.version);
                await sshExec(`command -v rvm &> /dev/null || { curl -sSL https://rvm.io/mpapis.asc | gpg --import -; curl -sSL https://rvm.io/pkuczynski.asc | gpg --import -; }`);
                await sshExec(`command -v rvm &> /dev/null || { curl -sSL https://get.rvm.io | bash -s master; source ~/.rvm/scripts/rvm; rvm autolibs disable; }`);
                if (rarg.binary) {
                    await sshExec(`curl -sSL "${rarg.binary}" | tar -zaxf - -C ~/.rvm/rubies`);
                    await sshExec("rvm alias create default " + rarg.version + ' --create');
                } else {
                    await sshExec(`rvm install ${rarg.version} --no-docs`);
                }
                await sshExec(`rvm use ${rarg.version} --default`);
                await sshExec("ruby --version");
            }
            break;
        case 'bun':
            arg = value;
            if (arg == 'off') {
                await writeLog("$> Removing Bun engine");
                await sshExec("chmod -R 0700 ~/.local/opt/bun-*");
                await sshExec("rm -rf ~/.local/opt/bun-* ~/.local/opt/bun ~/Downloads/webi/bun");
            } else {
                if (value == "latest" || value == "current" || !value || value == "lts") {
                    arg = "";
                } else {
                    arg = "@" + value;
                }
                await writeLog("$> Changing Bun engine to " + (value || 'latest'));
                await sshExec(`curl -sS https://webinstall.dev/bun${arg} | bash ; source ~/.config/envman/PATH.env`);
                await sshExec("bun --version");
            }
            break;
        case 'zig':
            arg = value;
            if (arg == 'off') {
                await writeLog("$> Removing Zig engine");
                await sshExec("rm -rf ~/.local/opt/zig ~/Downloads/webi/zig");
            } else {
                if (value == "latest" || value == "current" || !value || value == "lts") {
                    arg = "";
                } else {
                    arg = "@" + value;
                }
                await writeLog("$> Changing Zig engine to " + (value || 'latest'));
                await sshExec(`curl -sS https://webinstall.dev/zig${arg} | bash ; source ~/.config/envman/PATH.env`);
                await sshExec("zig version");
            }
            break;
        case 'dotnet':
            arg = value;
            if (arg == 'off') {
                await writeLog("$> Removing Dotnet engine");
                await sshExec("rm -rf ~/.dotnet");
                await sshExec("pathman remove ~/.dotnet");
            } else {
                if (value == "latest" || value == "current") {
                    arg = "--version latest";
                } else if (!value || value == "lts" || value == "stable") {
                    arg = "--channel LTS";
                } else if (value == "sts") {
                    arg = "--channel STS";
                } else {
                    arg = '--channel ' + value;
                }
                await writeLog("$> Changing Dotnet engine to " + (value || 'lts'));
                await sshExec(`(curl -sS https://dotnet.microsoft.com/download/dotnet/scripts/v1/dotnet-install.sh | bash -s -- ${arg})`);
                await sshExec(`pathman add ~/.dotnet ; source ~/.config/envman/PATH.env`);
                await sshExec("dotnet --version");
            }
            break;
        case 'jdk':
        case 'java':
            arg = value;
            if (value == 'off') {
                await writeLog("$> Removing Java engine");
                await sshExec("rm -rf ~/.local/java");
                await sshExec("pathman remove ~/.local/java/jdk/bin");
            } else {
                const jarg = getJavaVersion(value);
                if (!jarg.binary) {
                    throw new Error(`No Java with version ${value} is available to install`);
                }
                await writeLog("$> Changing Java engine to " + jarg.version);
                await sshExec(`JDK=~/.local/java/jdk-${jarg.version}; mkdir -p $JDK; rm -rf $JDK/*`);
                await sshExec(`curl -sSL "${jarg.binary}" | tar -zaxf - -C $JDK`);
                await sshExec(`mv $JDK/*/* $JDK/ && find $JDK -type d -empty -delete`, false);
                await sshExec(`ln -sfn $JDK ~/.local/java/jdk; pathman add ~/.local/java/jdk/bin ; source ~/.config/envman/PATH.env`);
                await sshExec("java -version");
            }
            break;
        case 'neovim':
        case 'nvim':
            if (value == 'off') {
                await writeLog("$> Removing Neovim config");
                await sshExec(`rm -rf ~/.config/nvim ~/.local/state/nvim ~/.local/share/nvim`);
            } else {
                await writeLog("$> Installing Neovim Nvchad config");
                await sshExec(`git clone https://github.com/NvChad/starter ~/.config/nvim`);
            }
            break;
        default:
            break;
    }
    return arg;
}


/**
 * @param {string} chunk
 * @param {{ skipLineLen: number; 
 *   lastChunkIncomplete: boolean; 
 *   sshPs1Header: string; write: boolean; 
 *   writer: (s: string) => Promise<void>; 
 *   debug: boolean; }} ctx
 */
export async function handleSshOutput(chunk, ctx) {
    const originalChunk = chunk;
    const { write, writer, debug } = ctx;
    // TODO: Can't use sshPs1Header since cd dir can change it?
    const match = chunk.match(isDebian() ? /.+?\@.+?:.+?\$ $/ : /\[.+?\@.+? .+?\]\$ $/);
    // discard write carriage return or null character
    // "\r +\r" is a yarn specific pattern so discard it beforehand
    chunk = chunk.replace(/\r[ \r]+\r/g, '').replace(/[\r\0].*$/gm, '');
    if (ctx.skipLineLen > 0) {
        const chunkLineLen = countOf(chunk, "\n");
        if (chunkLineLen >= ctx.skipLineLen) {
            const trimTo = nthIndexOf(chunk, "\n", ctx.skipLineLen);
            chunk = chunk.substring(trimTo + 1);
            ctx.skipLineLen = 0;
        } else {
            chunk = '';
            ctx.skipLineLen -= chunkLineLen;
        }
    }
    debug && await (async function () {
        const splits = originalChunk.split('\n');
        if (ctx.lastChunkIncomplete) {
            await writer("\n");
            ctx.lastChunkIncomplete = false;
        }
        for (let i = 0; i < splits.length; i++) {
            const el = splits[i] + (i == splits.length - 1 ? "" : "\n");
            el && await writer("$< " + JSON.stringify(el) +
                (i < splits.length - 1 ? " +\n" : "\n"));
        }
    })();
    if (match) {
        if (!ctx.sshPs1Header || !chunk.endsWith(ctx.sshPs1Header)) {
            // first or cd dir
            ctx.sshPs1Header = chunk;
        } else if (write && chunk.length > ctx.sshPs1Header.length) {
            chunk = chunk.substring(0, chunk.length - ctx.sshPs1Header.length);
            await writer(chunk);
            ctx.lastChunkIncomplete = !chunk.endsWith('\n');
        }
        if (write && ctx.lastChunkIncomplete) {
            // the last program doesn't write "\n", we add it for readability
            await writer("\n");
            ctx.lastChunkIncomplete = false;
        }
    } else {
        if (write && chunk) {
            if (chunk === '\n') {
                if (ctx.lastChunkIncomplete) {
                    await writer("\n");
                    ctx.lastChunkIncomplete = false;
                }
            } else {
                await writer(chunk);
                ctx.lastChunkIncomplete = !chunk.endsWith('\n');
            }
        }
    }
    return match;
}
