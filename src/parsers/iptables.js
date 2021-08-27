/*
MIT License

Copyright (c) 2018 William Kronmiller

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

function tryMatch(re, str) {
    const matches = re.exec(str);
    if(!matches) {
      return [];
    }
    return matches;
  }

  /**
   * Parse a single rule for a chain
   */
  function parseRule(rule) {
    const words = rule.split(' ').filter(x => !!x);
    const rules = {};
    for (let i = 0; i < words.length; i+=2) {
      const k = words[i];
      const v = words?.[i + 1] || '';
      rules[k] = v.trim();
    }
    return rules;
  }

  /**
   * Parse a single table (e.g. nat) for IPTables
   */
  function parseTable(table) {
    const [name, ...body] = table.split('\n')
    // No # comments pls! Use -m comment --comment
      .filter(line => line.indexOf('#') !== 0)
      .map(lines => lines.trim());
    const chains = body.filter(line => line.indexOf(':') === 0);
    const rules = body.filter(line => line.indexOf('-A') === 0)
      .map(parseRule);
    return { name, chains, rules };
  }

  /**
   * Parse IPTables config file (e.g. /etc/sysconfig/network/iptables)
   */
  function parseIptablesDoc(doc) {
    const startTableRules = doc.indexOf('*');
    return doc.substring(startTableRules).split('*')
      .map(block => block.trim())
      .filter(block => block.length > 0)
      .map(parseTable)
      .reduce((obj, { name, ...rest }) => {
        obj[name] = rest;
        return obj;
      }, {});
  }

  function encodeRule(rules) {
    return Object.keys(rules).map(k => `${k} ${rules[k]}`).join(' ');
  }

  function encodeTable({ table, chains, rules }) {
    return `*${table}\n${chains.concat(rules.map(encodeRule)).join('\n')}\nCOMMIT`;
  }

  /**
   * Convert Javascript object to IPTables config file string. Meant to be mirror image of parseIptablesDoc
   */
  function encodeIPTables(tables) {
    return `${Object.keys(tables).map(table => encodeTable(Object.assign({ table }, tables[table]))).join('\n\n')}\n`; // newline required!
  }

  export { parseIptablesDoc, encodeIPTables };