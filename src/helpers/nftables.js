
export const deleteIfRecordExist = ( /** @type {string[]} */ arr, /** @type {string[]} */ record) => {
    const idx = arr.findIndex((x) => record.includes(x));
    if (idx === -1) {
        return false;
    } else {
        arr.splice(idx, 1);
        return true;
    }
}

export const appendIfRecordNotExist = ( /** @type {string[]} */ arr, /** @type {string[]} */ record) => {
    const idx = arr.findIndex((x) => record.includes(x));
    if (idx === -1) {
        arr.push(record[0])
        return true;
    } else {
        return false;
    }
}

/**
 * 
 * @param {string} doc 
 * @returns {string[]}
 */
export function parseIptablesDoc(doc = '') {
    return doc.split('\n').filter(x => x.startsWith(`add rule`))
}
/**
 * 
 * @param {string[]} doc 
 * @returns {string}
 */
export function encodeIptablesDoc(doc) {
    return '#!/usr/sbin/nft -f\n\n' + doc.join('\n') + '\n';
}

export function genRules(userName = "", userID = "") {
    return [
        `add rule inet filter WHITELIST-SET skuid ${userID} counter reject comment "${userName}"`,
    ]
}
