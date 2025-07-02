#!/usr/bin/env node

// stop renewing failed SSL certs if found

import shelljs from 'shelljs';
const { exec, ShellString, cat } = shelljs;

const cmdListCertsRenewals = 'virtualmin list-domains --name-only --with-feature letsencrypt_renew';
const askDomainDetailPrefix = 'virtualmin list-domains --simple-multiline --domain ';
const test = (process.env.NODE_ENV || '').toLowerCase() == "test";

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

/**
 * 
 * @param {string} domain 
 * @param {string} domainFile 
 */
function disableRenewal(domain, domainFile) {
    var c = cat(domainFile).replace(/\nletsencrypt_renew=1/, '');
    new ShellString(c).to(domainFile);
    count++;
}

const listCertsRenewals = cmd(cmdListCertsRenewals).trim().split('\n');

let count = 0;

for (const domain of listCertsRenewals) {
    if (test) {
        console.log(`TEST: Checking ${domain}`);
    }
    const domainDetail = cmd(askDomainDetailPrefix + domain);
    const lastIssuedDateStr = domainDetail.match(/Lets Encrypt cert issued: (.+)/) || domainDetail.match(/SSL provider cert issued: (.+)/);
    const expiryDateStr = domainDetail.match(/SSL cert expiry: (.+)/);
    const domainFileStr = domainDetail.match(/File: (.+)/);
    const sharedWithStr = domainDetail.match(/SSL shared with: (.+)/);
    if (lastIssuedDateStr && expiryDateStr && domainFileStr) {
        const lastIssuedDate = Date.parse(lastIssuedDateStr[1]);
        const expiryDate = Date.parse(expiryDateStr[1]);
        const domainFile = domainFileStr[1];
        const deltaExp = Math.trunc((expiryDate - Date.now()) / (3600000 * 24));
        const deltaHour = Math.trunc((Date.now() - lastIssuedDate) / (3600000));
        if (sharedWithStr) {
            if (test) {
                console.log(`TEST: Will disable renewal for ${domain} due to sharing`);
                continue;
            }
            console.log(`Disabling renewal for ${domain} due to sharing`);
            disableRenewal(domain, domainFile);
        } else if (deltaExp > 30) {
            if (test) {
                console.log(`TEST: Skipping ${domain} due to expiry ${deltaExp} days`);
            }
        } else if (deltaHour < 24) {
            if (test) {
                console.log(`TEST: Skipping ${domain} due to last issue ${deltaHour} hours`);
            }
        } else {
            if (test) {
                console.log(`TEST: Will check ${domain} due to last issue ${deltaHour} hours`);
                continue;
            }
            console.log(`Disabling renewal for ${domain} due to unable renew`);
            disableRenewal(domain, domainFile);
        }
    }
}

if (count == 0) {
    console.log('Done and nothing changed');
} else {
    console.log(`Change applied for ${count} domains`);
    console.log(`Total domains in active renewal: ${cmd(cmdListCertsRenewals).split('\n').length}`)
}