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
    const [, chain] = tryMatch(/-A\s([^\s]+)\s/, rule);
    const [, protocol] = tryMatch(/\s-p\s([A-Za-z]+)/, rule);
    const [, source] = tryMatch(/\s-s\s([^\s]+)/, rule);
    const [, sourcePort] = tryMatch(/\s--sport\s([^\s]+)/, rule);
    const [, destination] = tryMatch(/\s-d\s([^\s]+)/, rule);
    const [, destinationPort] = tryMatch(/\s--dport\s([^\s]+)/, rule);
    const [, destinationIp] = tryMatch(/\s--to-destination\s([^\s]+)/, rule);
    const [,match] = tryMatch(/\s-m\s((?!state|comment|limit)[^\s]+)\s/, rule);
    const [, jump] = tryMatch(/\s-j\s([^\s]+)/, rule);
    const [, goto] = tryMatch(/\s-g\s([^\s]+)/, rule);
    const [, inInterface] = tryMatch(/\s-i\s([^\s]+)/, rule);
    const [, outInterface] = tryMatch(/\s-o\s([^\s]+)/, rule);

    const [, state] = tryMatch(/\s-m\sstate\s--state\s([^\s]+)/, rule);

    const [, limit] = tryMatch(/\s-m limit --limit\s([^\s]+)/, rule);
    const [, logPrefix] = tryMatch(/\s--log-prefix\s("[^"]+")/, rule);
    const [, tos] = tryMatch(/\s--set-tos\s([^\s]+)/, rule);
    const [, comment] = tryMatch(/\s-m\scomment\s--comment\s("[^"]+")/, rule);

    return {
      rule,
      chain,
      protocol,
      source,
      sourcePort,
      destination,
      destinationPort,
      destinationIp,
      match,
      state,
      jump,
      goto,
      inInterface,
      outInterface,
      limit,
      logPrefix,
      tos,
      comment,
    };
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

  function encodeRule({
    chain,
    protocol,
    source,
    sourcePort,
    destination,
    destinationPort,
    destinationIp,
    match,
    state,
    inInterface,
    outInterface,
    limit,
    logPrefix,
    jump,
    goto,
    tos,
    comment,
  }) {
    function map2Str(str, elem) {
      if(elem) {
        return `${str} ${elem} `;
      }
      return '';
    }

    return map2Str('-A', chain) +
      map2Str('-p', protocol) +
      map2Str('-s', source) +
      map2Str('--sport', sourcePort) +
      map2Str('-d', destination) +
      map2Str('--dport', destinationPort) +
      map2Str('-m', match) +
      map2Str('-m state --state', state) +
      map2Str('-i', inInterface) +
      map2Str('-o', outInterface) +
      map2Str('-m limit --limit', limit) +
      map2Str('-j', jump) +
      map2Str('-g', goto) +
      map2Str('--to-destination', destinationIp) +
      map2Str('--log-prefix', logPrefix) +
      map2Str('--set-tos', tos) +
      map2Str('-m comment --comment', comment)
        .trim();
  }

  function encodeTable({ table, chains, rules }) {
    return `*${table}\n${chains.concat(rules.map(encodeRule)).join('\n')}\nCOMMIT`;
  }

  /**
   * Convert Javascript object to IPTables config file string. Meant to be mirror image of parseIptablesDoc
   */
  function encodeIPTables({ tables }) {
    return `${Object.keys(tables).map(table => encodeTable(Object.assign({ table }, tables[table]))).join('\n\n')}\n`; // newline required!
  }

  module.exports = { parseIptablesDoc, encodeIPTables };