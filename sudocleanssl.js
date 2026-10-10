#!/usr/bin/env node

// stop renewing failed SSL certs if found

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cmdListCertsRenewals = 'virtualmin list-domains --name-only --with-feature letsencrypt_renew';
const askDomainDetailPrefix = 'virtualmin list-domains --simple-multiline --domain ';
const test = (process.env.NODE_ENV || '').toLowerCase() == "test";

if (test) {
    console.log("Running in test mode");
}

const wildcardJsonPath = path.join(__dirname, '.tmp', 'wildcardssl.json');

/**
 * @type {string[]}
 */
let wildcardDomains = [];
if (existsSync(wildcardJsonPath)) {
    try {
        const wildcardData = JSON.parse(readFileSync(wildcardJsonPath, 'utf-8'));
        wildcardDomains = Object.keys(wildcardData);
    } catch (e) {
        console.error(`Warning: Failed to parse ${wildcardJsonPath}`, e.message);
    }
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
    
    const domainFileStr = domainDetail.match(/File: (.+)/);
    if (!domainFileStr) continue;
    const domainFile = domainFileStr[1];

    const matchedWildcard = wildcardDomains.find(wd => domain.endsWith('.' + wd));

    if (matchedWildcard) {
        if (test) {
            console.log(`TEST: Will disable renewal for ${domain} (matches wildcard .${matchedWildcard})`);
            continue;
        }
        console.log(`Disabling renewal for ${domain} (matches wildcard .${matchedWildcard})`);
        disableRenewal(domain, domainFile);
        continue;
    }
    
    const expiryTimeStr = domainDetail.match(/SSL cert expiry time: (\d+)/);
    const sharedWithStr = domainDetail.match(/SSL shared with: (.+)/);
    
    if (expiryTimeStr && domainFileStr) {
        // Multiply by 1000 because Node uses milliseconds, but Virtualmin outputs seconds
        const expiryUnix = parseInt(expiryTimeStr[1], 10) * 1000; 
        
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
