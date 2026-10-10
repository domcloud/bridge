#!/usr/bin/env node

// stop renewing failed SSL certs if found

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

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
    return execSync(str).toString('utf-8');
}

/**
 * 
 * @param {string} domain 
 * @param {string} domainFile 
 */
function disableRenewal(domain, domainFile) {
    var c = readFileSync(domainFile, { encoding: 'utf-8' }).replace(/\n?letsencrypt_renew=1/, '');
    writeFileSync(domainFile, c, { encoding: 'utf-8' });
    count++;
}

const listCertsRenewals = cmd(cmdListCertsRenewals).trim().split('\n').filter(Boolean);

let count = 0;

for (const domain of listCertsRenewals) {
    if (test) {
        console.log(`TEST: Checking ${domain}`);
    }
    const domainDetail = cmd(askDomainDetailPrefix + domain);
    
    // We now reliably use the exact Unix timestamp Virtualmin provides
    const expiryTimeStr = domainDetail.match(/SSL cert expiry time: (\d+)/);
    const domainFileStr = domainDetail.match(/File: (.+)/);
    const sharedWithStr = domainDetail.match(/SSL shared with: (.+)/);
    
    if (expiryTimeStr && domainFileStr) {
        // Multiply by 1000 because Node uses milliseconds, but Virtualmin outputs seconds
        const expiryUnix = parseInt(expiryTimeStr[1], 10) * 1000; 
        const domainFile = domainFileStr[1];
        
        // Calculate days remaining. If expired, this becomes a negative number.
        const deltaExp = Math.trunc((expiryUnix - Date.now()) / (3600000 * 24));

        if (sharedWithStr) {
            if (test) {
                console.log(`TEST: Will disable renewal for ${domain} due to sharing`);
                continue;
            }
            console.log(`Disabling renewal for ${domain} due to sharing`);
            disableRenewal(domain, domainFile);
            
        // If there are more than 14 days left, it's perfectly healthy (or hasn't failed enough times yet)
        } else if (deltaExp > 14) {
            if (test) {
                console.log(`TEST: Skipping ${domain} due to expiry being ${deltaExp} days away`);
            }
            
        // If it reaches here, it has <= 14 days left (or is already expired/negative). 
        // It has been failing for at least 16 days. Disable it.
        } else {
            if (test) {
                console.log(`TEST: Will disable ${domain} due to failure (Expires in ${deltaExp} days)`);
                continue;
            }
            console.log(`Disabling renewal for ${domain} due to unable to renew (Expires in ${deltaExp} days)`);
            disableRenewal(domain, domainFile);
        }
    }
}

if (count == 0) {
    console.log('Done and nothing changed');
} else {
    console.log(`Change applied for ${count} domains`);
    const remaining = cmd(cmdListCertsRenewals).trim().split('\n').filter(Boolean).length;
    console.log(`Total domains in active renewal: ${remaining}`)
}
