
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
        arr.splice(arr.length - 1, 0, record[0])
        return true;
    } else {
        return false;
    }
}

/**
 * 
 * @param {string} doc 
 * @returns {Record<string, string[]>}
 */
export function parseIptablesDoc(doc = '') {
    return doc.split('*').slice(1)
        .map(block => '*' + block.trim())
        .map(block => block.split("\n").filter(x => !x.startsWith('#')))
        .reduce((obj, block) => {
            obj[block[0].substring(1)] = block;
            return obj;
        }, {});
}

export function encodeIptablesDoc(doc) {
    return Object.values(doc).map(x => x.join('\n')).join('\n\n') + '\n';
}

export function genRules(userName = "", userID = "") {
    return [
        `-A OUTPUT -m owner --uid-owner ${userID} -j REJECT -m comment --comment "${userName}"`,
        `-A OUTPUT -m owner --uid-owner ${userName} -j REJECT`,
    ]
}
