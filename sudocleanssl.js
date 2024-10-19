#!/usr/bin/env node

// stop renewing failed SSL certs if found

import shelljs from 'shelljs';
const { exec, ShellString, cat } = shelljs;

// | DOMAIN NAME | PATH TO CERTIFICATE FILE | VALID UNTIL | EXPIRES IN | STATUS |
const certsExpiryRegexp = /^\| (\S+)\s+\| (\/.+?)\s+\| (.+?)\s+\| (.*?)\s+\| (\S+)\s+\|$/m;
const cmdListCertsExpiry = 'virtualmin list-certs-expiry --all-domains';
const cmdListCertsRenewals = 'virtualmin list-domains --name-only --with-feature letsencrypt_renew';
const askDomainDetailPrefix = 'virtualmin list-domains --simple-multiline --domain ';
const test = process.env.NODE_ENV == "test";

if (test) {
    console.log("Running in test mode");
}

/**
 * @param {string} str
 */
function cmd(str) {
    return exec(str, {
        silent: true,
        fatal: true,
    }).stdout.trim();
}

const listCertsExpiry = cmd(cmdListCertsExpiry).split('\n')
    .slice(5).map(x => certsExpiryRegexp.exec(x)).filter(x => x);
const listCertsRenewals = cmd(cmdListCertsRenewals).split('\n');

console.log(`Certs currently active: ${listCertsExpiry.length}, domains in active renewal: ${listCertsRenewals.length}`);

let count = 0;

for (const domain of listCertsRenewals) {
    const expData = listCertsExpiry.find(x => x[1] == domain);
    if (!expData) {
        console.error(`Cert info not found for ${domain}`)
        continue;
    }
    if (expData[5] == 'EXPIRED' || (expData[4].includes(' day') && parseInt(expData[4]) < 30)) {
        const domainDetail = cmd(askDomainDetailPrefix + domain);
        const lastIssuedDateExp = domainDetail.match(/Lets Encrypt cert issued: (.+)/);
        const domainFileExp = domainDetail.match(/File: (.+)/);
        if (lastIssuedDateExp && domainFileExp) {
            const lastIssuedDate = Date.parse(lastIssuedDateExp[1]);
            const domainFile = domainFileExp[1];
            if (Date.now() - lastIssuedDate > 86400000) {
                if (test) {
                    console.log('TEST: This domain will be validated: ' + domain);
                    continue;
                }
                console.log(`Disabling renewal for ${domain}`);
                var c = cat(domainFile).replace(/\nletsencrypt_renew=1/, '');
                new ShellString(c).to(domainFile);
                count++;
            } else {
                if (test) {
                    console.log(`TEST: Skipping ${domain} due to last issue ${Date.now() - lastIssuedDate / (86400000)} days`);
                }
            }
        }
    }
}

if (count == 0) {
    console.log('Done and nothing changed');
} else {
    console.log(`Change applied for ${count} domains`);
    console.log(`Total domains in active renewal: ${cmd(cmdListCertsRenewals).split('\n').length}`)
}
