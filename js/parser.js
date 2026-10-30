// ==========================================================================
// HNW Retirement & Trust Optimization Web Application — Brokerage Parser
// Supports Multi-File Ingestion of:
//  1. Fidelity Combined Multi-Account PDF Statements (Core Account, Stocks,
//     Stock Funds, Bond Funds, Short-term Funds, Mutual Funds, 529, HSA, IRA)
//  2. Vanguard PDF Statements (Employer 401(k) Investment Activity & Retail)
//  3. Fidelity & Vanguard CSV Exports
//  4. JSON Portfolio & Scenario Exports
// ==========================================================================

(function (global) {
  'use strict';

  const FIDELITY_REQUIRED_HEADERS = [
    'Account Name',
    'Account Number',
    'Symbol',
    'Description',
    'Quantity',
    'Last Price',
    'Current Value'
  ];

  const VANGUARD_REQUIRED_HEADERS = [
    'Account Number',
    'Investment Name',
    'Symbol',
    'Shares',
    'Share Price',
    'Balance'
  ];

  function parseCurrencyNumber(val) {
    if (typeof val === 'number') return isFinite(val) ? val : 0;
    if (!val) return 0;
    const cleaned = String(val)
      .replace(/[$,\s"a-zA-Z]/g, '')
      .replace(/^\((.*)\)$/, '-$1');
    const num = parseFloat(cleaned);
    return isFinite(num) ? num : 0;
  }

  function splitCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  function classifyFidelityBucket(accountName) {
    const upper = String(accountName || '').toUpperCase();
    if (upper.includes('DEFERRED COMPENSATION') || upper.includes('DEFERRED SAVINGS') || upper.includes('NQDC')) {
      return 'Deferred Comp';
    }
    if (upper.includes('ROTH')) {
      return 'Roth';
    }
    if (
      upper.includes('IRA') ||
      upper.includes('401K') ||
      upper.includes('401(K)') ||
      upper.includes('403B') ||
      upper.includes('403(B)') ||
      upper.includes('SEP') ||
      upper.includes('PRE-TAX') ||
      upper.includes('ROLLOVER') ||
      upper.includes('MATCH') ||
      upper.includes('QNEC')
    ) {
      return 'Pre-Tax';
    }
    if (
      upper.includes('BROKERAGE') ||
      upper.includes('INDIVIDUAL') ||
      upper.includes('JOINT') ||
      upper.includes('TOD') ||
      upper.includes('TRUST') ||
      upper.includes('529') ||
      upper.includes('HEALTH SAVINGS') ||
      upper.includes('HSA')
    ) {
      return 'Taxable';
    }
    return 'Taxable';
  }

  function classifyVanguardBucket(rowText) {
    const text = String(rowText || '').toUpperCase();
    if (text.includes('DEFERRED COMPENSATION') || text.includes('DEFERRED SAVINGS') || text.includes('NQDC')) {
      return 'Deferred Comp';
    }
    if (text.includes('ROTH IRA') || text.includes('ROTH')) {
      return 'Roth';
    }
    if (
      text.includes('TRADITIONAL IRA') ||
      text.includes('ROLLOVER IRA') ||
      text.includes('SEP IRA') ||
      text.includes('401K') ||
      text.includes('401(K)') ||
      text.includes('403B') ||
      text.includes('403(B)') ||
      text.includes('SAVINGS PLAN') ||
      text.includes('RETIREMENT PLAN') ||
      text.includes('PRE-TAX') ||
      text.includes('EMPLOYER MATCH') ||
      text.includes('EMPLOYEE ROLLOVER') ||
      text.includes('QNEC')
    ) {
      return 'Pre-Tax';
    }
    if (
      text.includes('BROKERAGE ACCOUNT') ||
      text.includes('BROKERAGE') ||
      text.includes('INDIVIDUAL') ||
      text.includes('JOINT')
    ) {
      return 'Taxable';
    }
    return 'Taxable';
  }

  // ==========================================================================
  // 1. CSV PARSER (Fidelity & Vanguard)
  // ==========================================================================
  function parseCSVContent(csvText, fileName = 'Statement.csv') {
    const lines = String(csvText || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < 2) {
      throw new Error(`${fileName}: CSV file must contain a header row and at least one data row.`);
    }

    let format = null;
    let headerIndex = -1;
    let headers = [];

    for (let i = 0; i < Math.min(lines.length, 15); i++) {
      const cols = splitCsvLine(lines[i]);
      const lowerCols = cols.map((c) => c.toLowerCase());

      const isFidelity = FIDELITY_REQUIRED_HEADERS.every((req) =>
        lowerCols.some((c) => c === req.toLowerCase())
      );
      if (isFidelity) {
        format = 'Fidelity (CSV)';
        headerIndex = i;
        headers = cols;
        break;
      }

      const isVanguard = VANGUARD_REQUIRED_HEADERS.every((req) =>
        lowerCols.some((c) => c === req.toLowerCase())
      );
      if (isVanguard) {
        format = 'Vanguard (CSV)';
        headerIndex = i;
        headers = cols;
        break;
      }
    }

    if (!format) {
      throw new Error(
        `${fileName}: Unrecognized CSV header schema. Expected Fidelity headers [Account Name, Account Number, Symbol, Description, Quantity, Last Price, Current Value] or Vanguard headers [Account Number, Investment Name, Symbol, Shares, Share Price, Balance].`
      );
    }

    const colMap = {};
    headers.forEach((h, idx) => {
      colMap[h.toLowerCase()] = idx;
    });

    const positions = [];
    const totals = {
      Taxable: 0,
      'Pre-Tax': 0,
      Roth: 0,
      'Deferred Comp': 0,
      taxableCostBasis: 0
    };

    for (let r = headerIndex + 1; r < lines.length; r++) {
      const row = splitCsvLine(lines[r]);
      if (row.length < headers.length - 1) continue;

      if (format.startsWith('Fidelity')) {
        const accountName = row[colMap['account name']] || '';
        const accountNumber = row[colMap['account number']] || '';
        const symbol = row[colMap['symbol']] || '';
        const description = row[colMap['description']] || '';
        const quantity = parseCurrencyNumber(row[colMap['quantity']]);
        const lastPrice = parseCurrencyNumber(row[colMap['last price']]);
        const currentValue = parseCurrencyNumber(row[colMap['current value']]);
        const costBasisIdx = colMap['cost basis total'] ?? colMap['cost basis'];
        const costBasis =
          costBasisIdx !== undefined ? parseCurrencyNumber(row[costBasisIdx]) : currentValue * 0.6;

        if (!currentValue && !symbol) continue;

        const bucket = classifyFidelityBucket(accountName);
        totals[bucket] += currentValue;
        if (bucket === 'Taxable') {
          totals.taxableCostBasis += costBasis > 0 ? costBasis : currentValue * 0.6;
        }

        positions.push({
          custodian: 'Fidelity',
          accountName,
          accountNumber,
          symbol,
          description,
          shares: quantity,
          price: lastPrice,
          value: currentValue,
          costBasis: costBasis > 0 ? costBasis : currentValue * 0.6,
          bucket
        });
      } else if (format.startsWith('Vanguard')) {
        const accountNumber = row[colMap['account number']] || '';
        const investmentName = row[colMap['investment name']] || '';
        const symbol = row[colMap['symbol']] || '';
        const shares = parseCurrencyNumber(row[colMap['shares']]);
        const sharePrice = parseCurrencyNumber(row[colMap['share price']]);
        const balance = parseCurrencyNumber(row[colMap['balance']]);
        const accountTypeCol = colMap['account type'] ?? colMap['account name'];
        const accountTypeStr = accountTypeCol !== undefined ? row[accountTypeCol] : '';

        if (!balance && !symbol) continue;

        const combinedRowString = `${accountTypeStr} ${investmentName} ${lines[r]}`;
        const bucket = classifyVanguardBucket(combinedRowString);
        totals[bucket] += balance;
        if (bucket === 'Taxable') {
          totals.taxableCostBasis += balance * 0.6;
        }

        positions.push({
          custodian: 'Vanguard',
          accountName: accountTypeStr || investmentName.split('-')[0].trim() || 'Vanguard Account',
          accountNumber,
          symbol,
          description: investmentName,
          shares,
          price: sharePrice,
          value: balance,
          costBasis: balance * 0.6,
          bucket
        });
      }
    }

    return {
      fileName,
      format,
      positions,
      totals
    };
  }

  // ==========================================================================
  // 2. JSON PARSER
  // ==========================================================================
  function parseJSONContent(jsonText, fileName = 'Statement.json') {
    let data;
    try {
      data = JSON.parse(jsonText);
    } catch (e) {
      throw new Error(`${fileName}: Invalid JSON syntax in uploaded statement file.`);
    }

    if (data && typeof data === 'object' && 'currentAge' in data && 'taxableBalance' in data) {
      return {
        fileName,
        format: 'ScenarioState',
        scenario: data,
        positions: data.importedAccounts || [],
        totals: {
          Taxable: Number(data.taxableBalance) || 0,
          'Pre-Tax': Number(data.preTaxBalance) || 0,
          Roth: Number(data.rothBalance) || 0,
          taxableCostBasis:
            ((Number(data.taxableBalance) || 0) * (Number(data.taxableCostBasisRatio) || 60)) / 100
        }
      };
    }

    const rawList = Array.isArray(data)
      ? data
      : Array.isArray(data.positions)
      ? data.positions
      : Array.isArray(data.accounts)
      ? data.accounts
      : null;

    if (!rawList) {
      throw new Error(
        `${fileName}: JSON file must contain a "positions" array or an array of holding objects.`
      );
    }

    const positions = [];
    const totals = {
      Taxable: 0,
      'Pre-Tax': 0,
      Roth: 0,
      'Deferred Comp': 0,
      taxableCostBasis: 0
    };

    rawList.forEach((item) => {
      const accountName =
        item['Account Name'] ||
        item.accountName ||
        item['Account Type'] ||
        item.accountType ||
        item['Investment Name'] ||
        '';
      const accountNumber = item['Account Number'] || item.accountNumber || 'N/A';
      const symbol = item.Symbol || item.symbol || 'N/A';
      const description =
        item.Description || item.description || item['Investment Name'] || item.investmentName || symbol;
      const shares = parseCurrencyNumber(item.Quantity ?? item.quantity ?? item.Shares ?? item.shares ?? 0);
      const price = parseCurrencyNumber(
        item['Last Price'] ?? item.lastPrice ?? item['Share Price'] ?? item.sharePrice ?? 0
      );
      const value = parseCurrencyNumber(
        item['Current Value'] ?? item.currentValue ?? item.Balance ?? item.balance ?? item.value ?? 0
      );
      const costBasis = parseCurrencyNumber(
        item['Cost Basis Total'] ?? item.costBasis ?? value * 0.6
      );

      const isVanguardStyle =
        ('Investment Name' in item || 'Balance' in item) && !('Account Name' in item);
      const bucket = isVanguardStyle
        ? classifyVanguardBucket(`${accountName} ${description}`)
        : classifyFidelityBucket(accountName);

      totals[bucket] += value;
      if (bucket === 'Taxable') {
        totals.taxableCostBasis += costBasis > 0 ? costBasis : value * 0.6;
      }

      positions.push({
        custodian: isVanguardStyle ? 'Vanguard (JSON)' : 'Fidelity (JSON)',
        accountName: accountName || 'Portfolio Account',
        accountNumber,
        symbol,
        description,
        shares,
        price,
        value,
        costBasis: costBasis > 0 ? costBasis : value * 0.6,
        bucket
      });
    });

    return {
      fileName,
      format: data.brokerage || 'JSON Portfolio',
      positions,
      totals
    };
  }

  // ==========================================================================
  // 3A. FIDELITY MULTI-ACCOUNT COMBINED PDF STATEMENT PARSER
  //     Parses:
  //     - Page 2 "Accounts Included in This Report" directory
  //     - Per-account headers ("Account # X86-328847", "KELSEY ANN VAUGHN - INDIVIDUAL - TOD")
  //     - Multi-table "Holdings" sections (Core Account, Stocks, Stock Funds,
  //       Bond Funds, Short-term Funds, Mutual Funds, 529, HSA) including
  //       multi-line wrapped security descriptions and rows with or without '$' signs.
  // ==========================================================================
  function parseFidelityMultiAccountPDF(lines, fileName) {
    // Map of accountNumber -> accountName discovered from Page 2 or per-page headers
    const accountDirectory = {};
    let currentAccountNumber = 'FID-ACCT';
    let currentAccountName = 'Fidelity Account';
    let inHoldingsSection = false;
    let awaitingAccountNameLine = false;

    const positions = [];
    let pendingDescParts = [];
    let lastIncompleteHolding = null;

    // Matches the numeric signature of every Fidelity Holdings row:
    // [Optional Pct (e.g. "2.47 %", "59.96", "100 %", "65")] <BeginningMV (2 dec or 'unavailable'/'not applicable')> <Quantity (3 dec)> <Price (4 dec)> <EndingMV (2 dec)> [Optional CostBasis (2 dec or 'not applicable'/'unavailable')]
    const fidelityHoldingNumbersRegex =
      /(?:^|\s)(?:(\d{1,3}(?:\.\d{1,2})?(?:\s*%)?)\s+)?(\$?[\d,]+\.\d{2}|unavailable|not\s+applicable)\s+([\d,]+\.\d{3})\s+\$?([\d,]+\.\d{4})\s+\$?([\d,]+\.\d{2})(?:\s+(?:(\$?[\d,]+\.\d{2})(?:\s*[a-z])?|not\s+applicable|unavailable))?/i;

    // Single-line compact Fidelity holding format (e.g., "NVIDIA CORP (NVDA) 12,000.000 $135.00 $1,620,000.00 $140,000.00")
    const compactFidelityHoldingRegex =
      /^(.+?)\s*\(([A-Z]{1,6})\)\s+([\d,]+\.?\d*)\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})(?:\s+\$?([\d,]+\.\d{2}|not\s+applicable))?$/i;

    const isIgnoredHoldingsMetadataLine = (txt) => {
      if (!txt) return true;
      const t = txt
        .replace(/\bMR_CE\s*_[A-Z0-9_]+\s*\d{8}\b/gi, '')
        .replace(/\s+S$/i, '')
        .trim();
      if (!t || t === '-' || t === '--' || /^[A-Z]$/i.test(t)) return true;
      if (/^(--\s*\d+-day\s+yield|Please\s+note\s+that|All\s+positions\s+held|Estimated\s+Annual\s+Income|Total\s+Cost|Third-party\s+provided|Position\s+held\s+in\s+margin|t\s+Third-party|M\s+Position|EAI|&?\s*EY\b|r\s+Please\s+note|Includes\s+exchange-traded|Message\s+about\s+your\s+CD|AI\s+\(Accrued\s+Interest\)|B\s+See\s+Additional)/i.test(t)) {
        return true;
      }
      if (/^(Holdings|Core\s+Account|Stocks|Common\s+Stock|Mutual\s+Funds|Stock\s+Funds|Bond\s+Funds|Short-term\s+Funds|Exchange\s+Traded\s+Products|Equity\s+ETPs|Fixed\s+Income\s+ETPs|Other\s+Holdings|Other|Bonds|Corporate\s+Bonds|Municipal\s+Bonds)(?:\s+\(continued\))?$/i.test(t)) {
        return true;
      }
      if (/^(Description|Percent\s+of|Beginning|Market\s+Value|Quantity|Price|Per\s+Unit|Ending|Total\s+Cost|Total\s+Value|Cost\s+Basis|Cost|Unrealized|Gain\/Loss|Accrued\s+Interest|EAI\s*\(\$\)|EY\s*\(\%\))$/i.test(t)) {
        return true;
      }
      // Multi-column table header lines (e.g., "Percent of Market Value Quantity Per Unit Accrued Interest (AI) Total Gain/Loss EAI ($) /")
      if (/\b(Market\s+Value|Quantity|Per\s+Unit|Accrued\s+Interest\s*\(AI\)|Unrealized|Gain\/Loss|Cost\s+Basis)\b/i.test(t) && /\b(Quantity|Per\s+Unit|EAI|Gain\/Loss|Beginning|Ending|Sep\s+\d)\b/i.test(t)) {
        return true;
      }
      if (/^(Description|Percent\s+of|Beginning|Market\s+Value|Quantity|Price|Per\s+Unit|Ending|Cost\s+Basis|Unrealized|Gain\/Loss)\b/i.test(t) && !/\([A-Z]{2,6}\)/.test(t)) {
        return true;
      }
      if (/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\b/i.test(t)) {
        return true;
      }
      if (/^(INVESTMENT\s+REPORT|September|October|November|December|January|February|March|April|May|June|July|August|\d+\s+of\s+\d+|MR_CE)/i.test(t)) {
        return true;
      }
      // Pure standalone EAI / EY yield numbers at the end of a wrapped line (e.g., "21.260", "1.140", "3.430%")
      if (/^[\d,]+\.\d{3}%?$/.test(t)) {
        return true;
      }
      return false;
    };

    const cleanDescriptionFragment = (raw) => {
      let s = String(raw || '')
        .replace(/\bMR_CE\s*_[A-Z0-9_]+\s*\d{8}\b/gi, '') // Strip vertical margin barcode if inline
        .replace(/\s+S$/i, '') // Strip trailing page margin marker 'S'
        .replace(/^\s*M\s+(?=[A-Z])/i, '') // Strip leading margin indicator 'M '
        .replace(/\s+t\s*(?=\(|$)/i, ' ') // Strip third-party footnote 't'
        .replace(/--.*$/i, '') // Strip '-- 7-day yield: ...'
        .replace(/\s+-\s*$/, '') // Strip trailing '-' (empty EAI/EY column)
        .replace(/\s+\$?[\d,]+\.\d{2}\s*$/, '') // Strip trailing EAI or Accrued Interest dollar amount if attached
        .replace(/\s+\d+\.\d{3}%?\s*$/, '') // Strip trailing EY yield (e.g. 21.260 or 3.430%)
        .replace(/\s+-\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
      return s;
    };

    const extractParentheticalSymbol = (desc) => {
      const str = String(desc || '').trim();
      const matches = Array.from(str.matchAll(/\(([A-Z0-9\s.&-]+)\)/g));
      if (matches.length > 0) {
        return matches[matches.length - 1][1].trim();
      }
      return null;
    };

    // Pass 1: Pre-scan Page 2 "Accounts Included in This Report" directory and page headers
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Page 2 directory row pattern: "<PageNum> <Account Type/Name> <AcctNum> <BegVal> <EndVal>"
      const dirMatch = line.match(
        /^\d{1,3}\s+(.+?)\s+([A-Z0-9]{3}-\d{6}|\d{3}-\d{6})\s+\$?[\d,]+\.\d{2}\s+\$?[\d,]+\.\d{2}$/i
      );
      if (dirMatch) {
        const rawDirName = dirMatch[1].replace(/\s+-\s*$/, '').trim();
        const acctNum = dirMatch[2].toUpperCase();
        if (!accountDirectory[acctNum]) {
          accountDirectory[acctNum] = rawDirName;
        }
      }
    }

    // Pass 2: Parse per-account sections and Holdings tables
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 1. Check for per-page "Account # <AcctNum>" or "Account: <Name> Account Number: <AcctNum>" header
      const altAcctHeaderMatch = line.match(
        /Account:\s*(.+?)\s+Account\s*(?:Number|#|No\.?)?:\s*([A-Z0-9]{3}-\d{6}|\d{3}-\d{6}|[A-Z]\d{8})/i
      );
      if (altAcctHeaderMatch) {
        currentAccountName = altAcctHeaderMatch[1].trim();
        currentAccountNumber = altAcctHeaderMatch[2].toUpperCase();
        accountDirectory[currentAccountNumber] = currentAccountName;
        pendingDescParts = [];
        lastIncompleteHolding = null;
        awaitingAccountNameLine = false;
        continue;
      }

      const acctHeaderMatch = line.match(/Account\s*#\s*([A-Z0-9]{3}-\d{6}|\d{3}-\d{6}|[A-Z]\d{8})\b(.*)$/i);
      if (acctHeaderMatch) {
        const acctNum = acctHeaderMatch[1].toUpperCase();
        const restOfHeader = (acctHeaderMatch[2] || '').trim();
        currentAccountNumber = acctNum;
        pendingDescParts = [];
        lastIncompleteHolding = null;

        if (/\b(Activity|Estimated\s+Cash\s+Flow|Additional\s+Information|Account\s+Summary)\b/i.test(restOfHeader)) {
          inHoldingsSection = false;
        } else if (/\bHoldings\b/i.test(restOfHeader)) {
          inHoldingsSection = true;
        }

        const cleanedName = restOfHeader
          .replace(/\b(Account\s+Summary|Holdings|Activity|Estimated\s+Cash\s+Flow\s*\(.*?\)|Estimated\s+Cash\s+Flow|Additional\s+Information\s+and\s+Endnotes)\b/gi, '')
          .trim();

        if (cleanedName.length >= 3) {
          currentAccountName = cleanedName;
          accountDirectory[currentAccountNumber] = currentAccountName;
          awaitingAccountNameLine = false;
        } else {
          if (accountDirectory[currentAccountNumber]) {
            currentAccountName = accountDirectory[currentAccountNumber];
          }
          awaitingAccountNameLine = true;
        }
        continue;
      }

      if (awaitingAccountNameLine) {
        awaitingAccountNameLine = false;
        // The line immediately following "Account # <AcctNum>" often combines the section title (left) and Account Name (right):
        // e.g., "Holdings KELSEY ANN VAUGHN - ROLLOVER IRA" or "Account Summary KELSEY ANN VAUGHN - INDIVIDUAL - TOD"
        if (/^Holdings\b/i.test(line)) {
          inHoldingsSection = true;
        } else if (/^(Account\s+Summary|Activity|Estimated\s+Cash\s+Flow|Additional\s+Information)\b/i.test(line)) {
          inHoldingsSection = false;
        }

        const candidateAcctLine = line
          .replace(/^.*?Account\s+Value:\s*\$[\d,]+\.\d{2}\s*/i, '')
          .replace(/^(Account\s+Summary|Holdings|Activity|Estimated\s+Cash\s+Flow\s*\(.*?\)|Estimated\s+Cash\s+Flow|Additional\s+Information\s+and\s+Endnotes)\b\s*/i, '')
          .trim();

        if (
          candidateAcctLine.length >= 4 &&
          candidateAcctLine.length <= 80 &&
          !/^(Account\s+Value|Realized\s+Gains|Income\s+Summary|Top\s+Holdings|College\s+Investment)/i.test(candidateAcctLine)
        ) {
          currentAccountName = candidateAcctLine;
          accountDirectory[currentAccountNumber] = currentAccountName;
          continue;
        }
      }

      // 2. Check for standalone section transitions on the page
      if (/^Holdings$/i.test(line)) {
        inHoldingsSection = true;
        pendingDescParts = [];
        lastIncompleteHolding = null;
        continue;
      }

      if (
        /^(Total\s+Holdings|Total\s+Market\s+Value|Activity|Core\s+Fund\s+Activity|Securities\s+Bought\s*&\s*Sold|Dividends,\s+Interest|Estimated\s+Cash\s+Flow|Additional\s+Information|College\s+Contribution\s+Elections|Top\s+Holdings|Income\s+Summary)\b/i.test(
          line
        )
      ) {
        inHoldingsSection = false;
        pendingDescParts = [];
        lastIncompleteHolding = null;
        continue;
      }

      // Reset description buffers on sub-table category headers or sub-table Total rows inside Holdings
      const normalizedLineNoS = line.replace(/\s+S$/i, '').trim();
      if (
        inHoldingsSection &&
        (/^(Total\s+Core\s+Account|Total\s+Common\s+Stock|Total\s+Stocks|Total\s+Stock\s+Funds|Total\s+Bond\s+Funds|Total\s+Short-term\s+Funds|Total\s+Mutual\s+Funds|Total\s+Equity\s+ETPs|Total\s+Fixed\s+Income\s+ETPs|Total\s+Exchange\s+Traded|Total\s+Other|Products$|holdings\)$)/i.test(
          normalizedLineNoS
        ) ||
          /^(Core\s+Account|Stocks|Common\s+Stock|Mutual\s+Funds|Stock\s+Funds|Bond\s+Funds|Short-term\s+Funds|Exchange\s+Traded\s+Products|Equity\s+ETPs|Fixed\s+Income\s+ETPs|Other)(?:\s+\(continued\))?$/i.test(
            normalizedLineNoS
          ))
      ) {
        pendingDescParts = [];
        lastIncompleteHolding = null;
        continue;
      }

      if (!inHoldingsSection) {
        // Also support compact single-line Fidelity PDFs that don't have a separate "Holdings" banner
        const compactMatch = line.match(compactFidelityHoldingRegex);
        if (compactMatch && !/^(0\d|1[0-2])\/\d{2}\b/.test(line)) {
          const description = `${compactMatch[1].trim()} (${compactMatch[2].toUpperCase()})`;
          const symbol = compactMatch[2].toUpperCase();
          const value = parseCurrencyNumber(compactMatch[5]);
          const rawBasis = compactMatch[6] ? parseCurrencyNumber(compactMatch[6]) : 0;
          if (value > 0) {
            positions.push({
              custodian: 'Fidelity (PDF)',
              accountName: accountDirectory[currentAccountNumber] || currentAccountName,
              accountNumber: currentAccountNumber,
              symbol,
              description,
              value,
              costBasis: rawBasis > 0 ? rawBasis : value * 0.6,
              bucket: classifyFidelityBucket(accountDirectory[currentAccountNumber] || currentAccountName)
            });
          }
        }
        continue;
      }

      // 3. Inside a Fidelity "Holdings" section: check if this line contains the holding numeric columns
      const numMatch = line.match(fidelityHoldingNumbersRegex);
      if (numMatch && !/^Total\b/i.test(line)) {
        const matchIndex = numMatch.index || 0;
        const rawPrefix = line.slice(0, matchIndex).trim();
        const cleanedPrefix = cleanDescriptionFragment(rawPrefix);

        const quantity = parseCurrencyNumber(numMatch[3]);
        const price = parseCurrencyNumber(numMatch[4]);
        const endingMarketValue = parseCurrencyNumber(numMatch[5]);
        const rawCostBasis = numMatch[6] ? parseCurrencyNumber(numMatch[6]) : 0;

        // Verify quantity * price ≈ endingMarketValue (within 2% or $2 tolerance)
        const approxProduct = quantity * price;
        const isValidHoldingMath =
          endingMarketValue > 0 &&
          (Math.abs(approxProduct - endingMarketValue) <= 2.5 ||
            Math.abs(approxProduct - endingMarketValue) / endingMarketValue <= 0.02);

        if (isValidHoldingMath) {
          const descParts = pendingDescParts.slice();
          if (cleanedPrefix && !isIgnoredHoldingsMetadataLine(cleanedPrefix)) {
            descParts.push(cleanedPrefix);
          }
          pendingDescParts = [];

          const combinedDesc = descParts.join(' ').replace(/\s+/g, ' ').trim();
          const extractedSym = extractParentheticalSymbol(combinedDesc);
          const resolvedAcctName = accountDirectory[currentAccountNumber] || currentAccountName;
          const bucket = classifyFidelityBucket(resolvedAcctName);

          const isMoneyMarket = Math.abs(price - 1.0) < 0.001;
          const resolvedCostBasis =
            rawCostBasis > 0
              ? rawCostBasis
              : isMoneyMarket
              ? endingMarketValue
              : endingMarketValue * 0.6;

          const holdingObj = {
            custodian: 'Fidelity (PDF)',
            accountName: resolvedAcctName,
            accountNumber: currentAccountNumber,
            holdingName: combinedDesc || 'Holding',
            symbol: extractedSym || combinedDesc || 'HOLDING',
            description: combinedDesc || 'Holding',
            value: endingMarketValue,
            costBasis: resolvedCostBasis,
            bucket,
            _firstLine: combinedDesc || 'Holding',
            _extraLines: []
          };

          positions.push(holdingObj);
          lastIncompleteHolding = holdingObj;
          continue;
        }
      }

      // 4. Non-numeric line inside "Holdings": appends wrapped description lines to `lastIncompleteHolding`
      const cleanedFrag = cleanDescriptionFragment(line);
      if (!cleanedFrag || isIgnoredHoldingsMetadataLine(cleanedFrag)) {
        continue;
      }

      if (lastIncompleteHolding) {
        lastIncompleteHolding._extraLines.push(cleanedFrag);
        const fullCombined = [lastIncompleteHolding._firstLine, ...lastIncompleteHolding._extraLines]
          .join(' ')
          .replace(/\s+\(/g, ' (')
          .replace(/\s+/g, ' ')
          .trim();

        const sym = extractParentheticalSymbol(fullCombined);
        const isCdOrFixedCoupon =
          !sym &&
          (/\bCD\b/i.test(lastIncompleteHolding._firstLine) ||
            /\b(FIXED\s+COUPON|FDIC\s+INSURED|CUSIP:)\b/i.test(fullCombined));

        if (isCdOrFixedCoupon) {
          // For CDs / fixed-coupon holdings:
          // - Holding column (`holdingName`) uses the first line (e.g., "BANC OF CALIF LOS ANGE CD")
          // - SYMBOL column (`symbol`) uses that same first line
          // - DESCRIPTION column (`description`) uses the remaining description lines
          const cleanFirstLine = lastIncompleteHolding._firstLine.replace(/\bCD\s+B$/i, 'CD').trim();
          lastIncompleteHolding.holdingName = cleanFirstLine;
          lastIncompleteHolding.symbol = cleanFirstLine;
          lastIncompleteHolding.description = lastIncompleteHolding._extraLines
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        } else {
          lastIncompleteHolding.holdingName = fullCombined;
          lastIncompleteHolding.description = fullCombined;
          if (sym) {
            lastIncompleteHolding.symbol = sym;
          }
        }
      } else {
        pendingDescParts.push(cleanedFrag);
      }
    }

    positions.forEach((p) => {
      delete p._firstLine;
      delete p._extraLines;
    });

    return positions;
  }

  // ==========================================================================
  // 3A-2. FIDELITY NONQUALIFIED DEFERRED COMPENSATION PLAN (NQDC) PDF PARSER
  //       Parses:
  //       - Plan Name (e.g., "MICROSOFT DEFERRED COMPENSATION PLAN")
  //       - "Market Value of Your Account" holdings (PIM Total RT Inst,
  //         BTC Lpath Idx Ret M, BTC Lpath Idx 2030 M, etc.)
  //       - "Market Value of Deferrals" & "Market Value of Distributions"
  //         installment schedule (e.g., 3 Year / 4 Year / 5 Year Installment Annual
  //         beginning in Distribution Year 2025, 2026, 2027, 2028, 2029)
  // ==========================================================================
  function parseFidelityDeferredCompPDF(lines, fileName) {
    const fullText = lines.join('\n');
    const isDeferredCompDoc =
      /DEFERRED\s+COMPENSATION\s+PLAN/i.test(fullText) ||
      (/Deferred\s+Savings\s+Statement/i.test(fullText) && /Market\s+Value\s+of\s+Deferrals/i.test(fullText));

    if (!isDeferredCompDoc) {
      return null;
    }

    // 1. Identify Plan Name (e.g., "MICROSOFT DEFERRED COMPENSATION PLAN")
    let planName = 'DEFERRED COMPENSATION PLAN';
    for (let i = 0; i < Math.min(lines.length, 20); i++) {
      const line = lines[i];
      if (/DEFERRED\s+COMPENSATION\s+PLAN/i.test(line)) {
        const cleaned = line.replace(/Deferred\s+Savings\s+Statement/gi, '').trim();
        if (cleaned.length >= 10) {
          planName = cleaned;
          break;
        }
      }
      if (/^([A-Z0-9\s.&'-]+?)\s+DEFERRED$/i.test(line)) {
        const prefix = line.replace(/\s+Deferred\s+Savings\s+Statement/gi, '').trim();
        for (let j = i + 1; j <= Math.min(lines.length - 1, i + 3); j++) {
          if (/^COMPENSATION\s+PLAN\b/i.test(lines[j])) {
            planName = `${prefix} COMPENSATION PLAN`.replace(/\s+/g, ' ').trim();
            break;
          }
        }
        if (planName !== 'DEFERRED COMPENSATION PLAN') break;
      }
    }

    const accountNumber = 'NQDC-PLAN';
    const positions = [];
    const deferrals = [];

    // 2. Parse "Market Value of Your Account" holdings table
    // Rows have 2 share counts (3 decimals), 2 prices ($X.XX), and 2 market values ($X,XXX.XX):
    // e.g. "Inst 2,874.919 2,975.515 $8.86 $8.44 $25,471.78 $25,113.35"
    // or "20,404.372 17,498.398 $13.00 $13.69 $265,352.74 $239,570.56" with wrapped name above/below
    const holdingMetricsRegex =
      /(?:^|\s)([\d,]+\.\d{3})\s+([\d,]+\.\d{3})\s+\$?([\d,]+\.\d{2,4})\s+\$?([\d,]+\.\d{2,4})\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})$/;

    const isIgnoredHoldingFragment = (txt) => {
      if (!txt) return true;
      const t = txt.trim();
      if (!t) return true;
      if (
        /^(Market\s+Value\s+of\s+Your\s+Account|Statement\s+Period|This\s+section\s+displays|CORE\s+INVESTMENTS|TARGET\s+RETIREMENT\s+DATE\s+INVESTMENTS|Shares\s+as\s+of|Investment|12\/31\/\d{4}|Bond\s+\$|Income$|Blended\s+Fund\s+Investments|Account\s+Totals|Remember\s+that)/i.test(
          t
        )
      ) {
        return true;
      }
      if (/^\d{2}\/\d{2}\/\d{4}/.test(t)) return true;
      return false;
    };

    let inMarketValueSection = false;
    let pendingNameParts = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/^Market\s+Value\s+of\s+Your\s+Account\b/i.test(line)) {
        inMarketValueSection = true;
        pendingNameParts = [];
        continue;
      }

      if (
        inMarketValueSection &&
        (/^(Account\s+Totals|Remember\s+that\s+a\s+dividend|Market\s+Value\s+of\s+Deferrals|Market\s+Value\s+of\s+Distributions|Your\s+Contribution\s+Summary|Your\s+Account\s+Activity)\b/i.test(
          line
        ))
      ) {
        inMarketValueSection = false;
        pendingNameParts = [];
        continue;
      }

      if (!inMarketValueSection) continue;

      // Reset pending name buffer on category subheaders
      if (
        /^(CORE\s+INVESTMENTS|TARGET\s+RETIREMENT\s+DATE\s+INVESTMENTS|Bond\s+\$[\d,]+|Income$|Blended\s+Fund\s+Investments\*?\s+\$[\d,]+|Shares\s+as\s+of|Investment$|12\/31\/\d{4})/i.test(
          line
        )
      ) {
        pendingNameParts = [];
        continue;
      }

      const m = line.match(holdingMetricsRegex);
      if (m) {
        const matchIdx = m.index || 0;
        const prefix = line.slice(0, matchIdx).trim();
        const nameParts = pendingNameParts.slice();
        if (prefix && !isIgnoredHoldingFragment(prefix)) {
          nameParts.push(prefix);
        }
        pendingNameParts = [];

        // Check if the immediately following line is a short wrapped suffix (e.g., "Idx Ret M")
        // when the current line had no prefix (because "BTC Lpath" was above and "Idx Ret M" is below)
        if (!prefix && i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          if (
            nextLine &&
            !holdingMetricsRegex.test(nextLine) &&
            !isIgnoredHoldingFragment(nextLine) &&
            !/\$[\d,]+\.\d{2}/.test(nextLine) &&
            nextLine.length <= 28
          ) {
            // Only consume nextLine if the line after nextLine is NOT a pure numbers line
            const lineAfterNext = i + 2 < lines.length ? lines[i + 2].trim() : '';
            const nextAfterIsPureNumbers =
              holdingMetricsRegex.test(lineAfterNext) &&
              lineAfterNext.slice(0, lineAfterNext.match(holdingMetricsRegex).index || 0).trim() === '';
            if (!nextAfterIsPureNumbers) {
              nameParts.push(nextLine);
              i++; // consume suffix line
            }
          }
        }

        const fundName = nameParts.join(' ').replace(/\s+/g, ' ').trim() || 'Deferred Comp Fund';
        const shares = parseCurrencyNumber(m[2]);
        const price = parseCurrencyNumber(m[4]);
        const endingValue = parseCurrencyNumber(m[6]);

        if (endingValue > 0) {
          positions.push({
            custodian: 'Fidelity (PDF)',
            accountName: planName,
            accountNumber,
            holdingName: fundName,
            symbol: fundName,
            description: `${fundName} (${planName})`,
            shares,
            price,
            value: endingValue,
            costBasis: 0, // NQDC distributions are 100% W-2 ordinary income
            bucket: 'Deferred Comp'
          });
        }
        continue;
      }

      if (!isIgnoredHoldingFragment(line) && !/\$[\d,]+\.\d{2}/.test(line)) {
        pendingNameParts.push(line.trim());
      }
    }

    // 3. Parse "Market Value of Deferrals" table to extract exact per-tranche installment schedules
    // Each tranche has:
    //   Header line: "<DeferralYear> <ContributionSource> <DistributionYear (2025..2050)> <N> Year Current"
    //   Value line:  "<DeferralYear> <ContributionSource> $<MarketValue>"
    let inDeferralsSection = false;
    let pendingTranche = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/^Market\s+Value\s+of\s+Deferrals\b/i.test(line)) {
        inDeferralsSection = true;
        pendingTranche = null;
        continue;
      }

      if (
        inDeferralsSection &&
        /^(Market\s+Value\s+of\s+Distributions|Your\s+Contribution\s+Summary|Your\s+Account\s+Activity)\b/i.test(
          line
        )
      ) {
        inDeferralsSection = false;
        pendingTranche = null;
        continue;
      }

      if (!inDeferralsSection) continue;

      // Match tranche header line:
      // e.g. "2018 Base Salary (post 2013) 2025 5 Year Current"
      // or   "Other Signing Bonus (post 2013) 2025 3 Year Current"
      const trancheHeaderMatch = line.match(
        /^(\d{4}|Other(?:\s+Contributions)?)\s+(.+?)\s+(20\d{2})\s+(\d{1,2})\s+Year\b/i
      );
      if (trancheHeaderMatch) {
        pendingTranche = {
          deferralYear: trancheHeaderMatch[1].trim(),
          source: trancheHeaderMatch[2].trim(),
          distributionStartYear: parseInt(trancheHeaderMatch[3], 10),
          installmentYears: parseInt(trancheHeaderMatch[4], 10)
        };
        continue;
      }

      // Also support Lump Sum election if present
      const lumpHeaderMatch = line.match(
        /^(\d{4}|Other(?:\s+Contributions)?)\s+(.+?)\s+(20\d{2})\s+Lump\s+Sum\b/i
      );
      if (lumpHeaderMatch) {
        pendingTranche = {
          deferralYear: lumpHeaderMatch[1].trim(),
          source: lumpHeaderMatch[2].trim(),
          distributionStartYear: parseInt(lumpHeaderMatch[3], 10),
          installmentYears: 1
        };
        continue;
      }

      // Match tranche dollar amount line (excluding "<Year> Total $..." and "Total Value $...")
      if (pendingTranche && !/\bTotal\b/i.test(line)) {
        const valMatch = line.match(/\$([\d,]+\.\d{2})\s*$/);
        if (valMatch) {
          const balance = parseCurrencyNumber(valMatch[1]);
          if (balance > 0) {
            deferrals.push({
              planName,
              deferralYear: pendingTranche.deferralYear,
              source: pendingTranche.source,
              distributionStartYear: pendingTranche.distributionStartYear,
              installmentYears: pendingTranche.installmentYears,
              balance
            });
            pendingTranche = null;
          }
        }
      }
    }

    if (positions.length === 0) {
      return null;
    }

    return {
      planName,
      positions,
      deferrals
    };
  }

  // ==========================================================================
  // 3A-2. SOCIAL SECURITY STATEMENT PARSER (Form SSA-7005 / "Your Social Security Statement")
  // ==========================================================================
  function parseSocialSecurityPDF(lines, fileName = 'SocialSecurityStatement.pdf') {
    const fullText = lines.join('\n');

    // 1. Beneficiary Name
    let name = '';
    for (let i = 0; i < Math.min(lines.length, 15); i++) {
      const l = lines[i].trim();
      if (/your social security statement/i.test(l)) continue;
      if (
        l &&
        !/^(october|november|december|january|february|march|april|may|june|july|august|september)\b/i.test(l) &&
        !/^retirement benefits/i.test(l) &&
        !/^social security/i.test(l) &&
        /^[A-Z\s.,'-]+$/.test(l) &&
        l.length >= 3
      ) {
        name = l;
        break;
      }
    }

    // 2. Statement Date
    let statementDate = '';
    const dateMatch = fullText.match(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i
    );
    if (dateMatch) statementDate = dateMatch[0];

    // 3. Date of Birth & Birth Year
    let dob = '';
    let birthYear = 0;
    const dobMatch = fullText.match(/date of birth:\s*([A-Za-z]+ \d{1,2}, \d{4})/i);
    if (dobMatch) {
      dob = dobMatch[1];
      const yMatch = dob.match(/\d{4}/);
      if (yMatch) birthYear = parseInt(yMatch[0], 10);
    }

    // 4. Full Retirement Age (FRA)
    let fra = 67;
    const fraMatch = fullText.match(/full retirement age is\s*(\d{2})/i);
    if (fraMatch) fra = parseInt(fraMatch[1], 10);

    // 5. Monthly Benefit Schedule (Ages 62 through 70)
    const benefitsByAge = {};
    const ageRegex = /\b(6[2-9]|70)\s+\$([0-9,]+)\b/g;
    let match;
    while ((match = ageRegex.exec(fullText)) !== null) {
      const age = parseInt(match[1], 10);
      const amount = parseInt(match[2].replace(/,/g, ''), 10);
      benefitsByAge[age] = amount;
    }

    const pia = benefitsByAge[fra] || benefitsByAge[67] || 0;

    // 6. Auxiliary & Disability Benefits
    let disabilityMonthly = 0;
    const disMatch = fullText.match(/disability benefits[\s\S]*?monthly payment would be about\s+\$([0-9,]+)/i);
    if (disMatch) disabilityMonthly = parseInt(disMatch[1].replace(/,/g, ''), 10);

    let spouseFra = 0;
    const survSpouseMatch = fullText.match(/Spouse, if benefits start at full retirement age:\s+\$([0-9,]+)/i);
    if (survSpouseMatch) spouseFra = parseInt(survSpouseMatch[1].replace(/,/g, ''), 10);

    let minorChild = 0;
    const childMatch = fullText.match(/Minor child:\s+\$([0-9,]+)/i);
    if (childMatch) minorChild = parseInt(childMatch[1].replace(/,/g, ''), 10);

    let spouseWithChild = 0;
    const spouseChildMatch = fullText.match(/Spouse, if caring for a disabled child or child younger than age 16:\s+\$([0-9,]+)/i);
    if (spouseChildMatch) spouseWithChild = parseInt(spouseChildMatch[1].replace(/,/g, ''), 10);

    let familyMax = 0;
    const famMatch = fullText.match(/Total family benefits cannot be more than:\s+\$([0-9,]+)/i);
    if (famMatch) familyMax = parseInt(famMatch[1].replace(/,/g, ''), 10);

    let lumpDeathBenefit = 255;
    const lumpDeathMatch = fullText.match(/one-time death benefit of\s+\$([0-9,]+)/i);
    if (lumpDeathMatch) lumpDeathBenefit = parseInt(lumpDeathMatch[1].replace(/,/g, ''), 10);

    // 7. Taxes Paid
    let ssWorker = 0, ssEmployer = 0, medWorker = 0, medEmployer = 0;
    const ssYouPaid = fullText.match(/You paid:\s+\$([0-9,]+)\s+You paid:\s+\$([0-9,]+)/i);
    if (ssYouPaid) {
      ssWorker = parseInt(ssYouPaid[1].replace(/,/g, ''), 10);
      medWorker = parseInt(ssYouPaid[2].replace(/,/g, ''), 10);
    }
    const ssEmpPaid = fullText.match(/Employer\(s\):\s+\$([0-9,]+)\s+Employer\(s\):\s+\$([0-9,]+)/i);
    if (ssEmpPaid) {
      ssEmployer = parseInt(ssEmpPaid[1].replace(/,/g, ''), 10);
      medEmployer = parseInt(ssEmpPaid[2].replace(/,/g, ''), 10);
    }

    // 8. Earnings Record (Annual Historical FICA Breakdown)
    const earningsRecord = [];
    const earnRegex = /\b(\d{4}(?:-\d{4})?)\s+\$([0-9,]+)\s+\$([0-9,]+)\b/g;
    let earnMatch;
    while ((earnMatch = earnRegex.exec(fullText)) !== null) {
      earningsRecord.push({
        year: earnMatch[1],
        ssEarnings: parseInt(earnMatch[2].replace(/,/g, ''), 10),
        medEarnings: parseInt(earnMatch[3].replace(/,/g, ''), 10)
      });
    }

    return {
      fileName,
      format: 'Social Security Statement (SSA-7005)',
      isSocialSecurity: true,
      socialSecurity: {
        name: name || 'Worker',
        statementDate,
        dob,
        birthYear,
        fra,
        pia,
        benefitsByAge,
        disabilityMonthly,
        survivors: {
          minorChild,
          spouseWithChild,
          spouseFra,
          familyMax,
          lumpDeathBenefit
        },
        taxesPaid: {
          ssWorker,
          ssEmployer,
          medWorker,
          medEmployer
        },
        earningsRecord
      },
      positions: [],
      deferrals: [],
      totals: {
        Taxable: 0,
        'Pre-Tax': 0,
        Roth: 0,
        'Deferred Comp': 0,
        taxableCostBasis: 0
      }
    };
  }

  // ==========================================================================
  // 3B. MASTER PDF STATEMENT PARSER (Dispatches Fidelity vs Vanguard)
  // ==========================================================================
  function parseExtractedPDFText(rawLines, fileName = 'Statement.pdf') {
    const lines = (rawLines || [])
      .map((l) => String(l || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      throw new Error(
        `${fileName}: No readable text layer found in PDF. Ensure the PDF is a digital statement rather than a scanned image.`
      );
    }

    const fullDocText = lines.join('\n');
    const upperDoc = fullDocText.toUpperCase();

    // Check for official Social Security Statement (Form SSA-7005)
    const isSocialSecurityDoc =
      (upperDoc.includes('YOUR SOCIAL SECURITY STATEMENT') ||
        upperDoc.includes('FORM SSA-7005') ||
        (upperDoc.includes('SOCIAL SECURITY') && upperDoc.includes('RETIREMENT BENEFITS'))) &&
      (upperDoc.includes('FULL RETIREMENT AGE') || upperDoc.includes('ESTIMATES'));

    if (isSocialSecurityDoc) {
      const parsedSS = parseSocialSecurityPDF(lines, fileName);
      if (parsedSS) return parsedSS;
    }

    const isVanguardDoc =
      upperDoc.includes('VANGUARD') &&
      !upperDoc.includes('FIDELITY INVESTMENTS') &&
      !upperDoc.includes('FIDELITY BROKERAGE') &&
      !upperDoc.includes('FIDELITY PRIVATE WEALTH');
    const detectedCustodian = isVanguardDoc ? 'Vanguard' : 'Fidelity';

    let positions = [];
    let deferrals = [];
    let detectedFormatLabel = `${detectedCustodian} Statement (PDF)`;

    // Check for Nonqualified Deferred Compensation Plan (NQDC) statement first
    const deferredCompParsed = parseFidelityDeferredCompPDF(lines, fileName);
    if (deferredCompParsed) {
      positions = deferredCompParsed.positions;
      deferrals = deferredCompParsed.deferrals || [];
      detectedFormatLabel = `${detectedCustodian} Deferred Comp (PDF)`;
    }

    // Use specialized Fidelity multi-account parser for standard Fidelity PDFs
    if (positions.length === 0 && detectedCustodian === 'Fidelity') {
      positions = parseFidelityMultiAccountPDF(lines, fileName);
    }

    // If Vanguard PDF (or if Fidelity fallback needed)
    if (positions.length === 0) {
      let currentAccountName = isVanguardDoc ? 'Vanguard Account' : 'Fidelity Account';
      let currentAccountNumber = 'PDF-ACCT';

      for (let i = 0; i < Math.min(lines.length, 40); i++) {
        const cleanedHeaderLine = lines[i]
          .replace(/^.*?\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\s+/i, '')
          .replace(/^.*?\b\d{5}-\d{4}\s+/i, '')
          .trim();

        const planMatch = cleanedHeaderLine.match(
          /([A-Z0-9\s.&()'-]+?(?:401\(K\)|403\(B\)|SAVINGS\s+PLAN|RETIREMENT\s+PLAN)[A-Z0-9\s.&()'-]*?)\s*(?:[—–‒―-]+|\s+#\s*)\s*(\d{4,10})\b/i
        );
        if (planMatch) {
          currentAccountName = planMatch[1].replace(/\s+[—–‒―-]+$/, '').trim();
          currentAccountNumber = planMatch[2].trim();
          break;
        }
      }

      const investmentActivityRows = [];
      const summaryFallbackRows = [];
      let topLevelTotalBalance = 0;

      const accountBannerRegex =
        /\b(INDIVIDUAL(?:\s*-\s*TOD)?(?:\s+BROKERAGE)?|BROKERAGE\s+ACCOUNT|TRADITIONAL\s+IRA|ROLLOVER\s+IRA|ROTH\s+IRA|SEP\s+IRA|EXECUTIVE\s+401\(?K\)?(?:\s+PLAN)?|JOINT\s+BROKERAGE)\b/i;
      const accountNumRegex =
        /(?:Account\s*(?:Number|#|No\.?)?[:\s-]*)?([A-Z0-9]{1,4}-\d{5,8}|\d{4}-\d{4}|\b[XYZ]\d{8}\b|\b\d{8,9}\b)/i;

      const vanguardLeadingTickerRegex =
        /^([A-Z]{2,5})\s+(.+?)\s+([\d,]+\.?\d*)\s+\$?([\d,]+\.?\d*)\s+\$?([\d,]+\.?\d*)(?:\s+\$?([\d,]+\.?\d*))?$/;

      const tabularMidTickerRegex =
        /^(.+?)\s+\b([A-Z]{2,5})\b\s+([\d,]+\.?\d*)\s+\$?([\d,]+\.?\d*)\s+\$?([\d,]+\.?\d*)(?:\s+\$?([\d,]+\.?\d*))?$/;

      let activePlanSection = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const upperLine = line.toUpperCase();

        const totalBalMatch = line.match(/Total\s+Account\s+Balance:?\s*\$([\d,]+\.\d{2})/i);
        if (totalBalMatch) {
          topLevelTotalBalance = parseCurrencyNumber(totalBalMatch[1]);
        }

        if (/^Investment\s+Activity$/i.test(line) || upperLine.startsWith('INVESTMENT ACTIVITY')) {
          activePlanSection = 'INVESTMENT_ACTIVITY';
          continue;
        }

        if (
          /^Total\s+Invested\b/i.test(line) ||
          /^Your\s+Fee\s+Summary/i.test(line) ||
          /^Your\s+Recommendations/i.test(line) ||
          /^Additional\s+Account\s+Details/i.test(line) ||
          /^Source\s+Activity/i.test(line) ||
          /^Beneficiaries/i.test(line) ||
          /^Benefit\s+Statement\s+Supplement/i.test(line) ||
          /^\u2021?\u2021?Additional\s+Information/i.test(line)
        ) {
          activePlanSection = 'IGNORE_PLAN_DETAILS';
          continue;
        }

        const dollarTokens = line.match(/[+-]?\s*\$[\d,]+\.\d{2}/g);

        if (activePlanSection === 'INVESTMENT_ACTIVITY' && dollarTokens && dollarTokens.length >= 5) {
          const firstDollarIdx = line.search(/[+-]?\s*\$[\d,]+\.\d{2}/);
          let fundLabel = firstDollarIdx > 0 ? line.slice(0, firstDollarIdx).trim() : '';
          if (!fundLabel && i > 0 && !lines[i - 1].includes('$')) {
            fundLabel = lines[i - 1].trim();
          }
          const endingBalance = parseCurrencyNumber(dollarTokens[dollarTokens.length - 1]);

          if (
            fundLabel &&
            !/^(Total\s+Invested|Total\s+Value|Total|Beginning|Ending|Balance)/i.test(fundLabel) &&
            endingBalance > 0
          ) {
            const bucket =
              detectedCustodian === 'Vanguard'
                ? classifyVanguardBucket(`${currentAccountName} ${fundLabel}`)
                : classifyFidelityBucket(`${currentAccountName} ${fundLabel}`);
            investmentActivityRows.push({
              custodian: `${detectedCustodian} (PDF)`,
              accountName: currentAccountName,
              accountNumber: currentAccountNumber,
              symbol: fundLabel,
              description: fundLabel,
              value: endingBalance,
              costBasis: endingBalance * 0.6,
              bucket
            });
            continue;
          }
        }

        if (activePlanSection === 'IGNORE_PLAN_DETAILS') {
          continue;
        }

        const bannerMatch = line.match(accountBannerRegex);
        if (bannerMatch && activePlanSection === null) {
          const candidateAcct = bannerMatch[1].trim();
          const numMatch = line.match(accountNumRegex);
          if (!vanguardLeadingTickerRegex.test(line)) {
            currentAccountName = candidateAcct;
            if (numMatch && numMatch[1]) {
              currentAccountNumber = numMatch[1];
            }
            if (dollarTokens && dollarTokens.length >= 1) {
              const val = parseCurrencyNumber(dollarTokens[dollarTokens.length - 1]);
              if (val > 0) {
                summaryFallbackRows.push({
                  custodian: `${detectedCustodian} (PDF)`,
                  accountName: currentAccountName,
                  accountNumber: currentAccountNumber,
                  symbol: currentAccountName,
                  description: `${currentAccountName} Summary Balance`,
                  value: val,
                  costBasis: val * 0.6,
                  bucket:
                    detectedCustodian === 'Vanguard'
                      ? classifyVanguardBucket(currentAccountName)
                      : classifyFidelityBucket(currentAccountName)
                });
              }
            }
            continue;
          }
        }

        const vgMatch = line.match(vanguardLeadingTickerRegex);
        if (vgMatch) {
          const symbol = vgMatch[1].toUpperCase();
          const description = vgMatch[2].trim();
          const shares = parseCurrencyNumber(vgMatch[3]);
          const value = parseCurrencyNumber(vgMatch[5]);
          const rawBasis = vgMatch[6] ? parseCurrencyNumber(vgMatch[6]) : 0;

          if (value > 0 && shares > 0 && !['TOTAL', 'PAGE', 'ACCT', 'DATE'].includes(symbol)) {
            const bucket = classifyVanguardBucket(`${currentAccountName} ${description}`);
            const costBasis = rawBasis > 0 ? rawBasis : value * 0.6;

            positions.push({
              custodian: 'Vanguard (PDF)',
              accountName: currentAccountName,
              accountNumber: currentAccountNumber,
              symbol,
              description,
              value,
              costBasis,
              bucket
            });
            continue;
          }
        }

        const tabMatch = line.match(tabularMidTickerRegex);
        if (tabMatch) {
          const description = tabMatch[1].trim();
          const symbol = tabMatch[2].toUpperCase();
          const shares = parseCurrencyNumber(tabMatch[3]);
          const price = parseCurrencyNumber(tabMatch[4]);
          const value = parseCurrencyNumber(tabMatch[5]);
          const rawBasis = tabMatch[6] ? parseCurrencyNumber(tabMatch[6]) : 0;

          const approxCheck = shares > 0 && price > 0 ? Math.abs(shares * price - value) / value < 0.05 : false;
          if (value > 0 && approxCheck && !['TOTAL', 'SHARES', 'VALUE', 'PRICE'].includes(symbol)) {
            const bucket =
              detectedCustodian === 'Vanguard'
                ? classifyVanguardBucket(`${currentAccountName} ${description}`)
                : classifyFidelityBucket(`${currentAccountName} ${description}`);
            const costBasis = rawBasis > 0 ? rawBasis : value * 0.6;

            positions.push({
              custodian: `${detectedCustodian} (PDF)`,
              accountName: currentAccountName,
              accountNumber: currentAccountNumber,
              symbol,
              description,
              value,
              costBasis,
              bucket
            });
            continue;
          }
        }
      }

      if (positions.length === 0 && investmentActivityRows.length > 0) {
        investmentActivityRows.forEach((row) => positions.push(row));
      }
      if (positions.length === 0 && summaryFallbackRows.length > 0) {
        summaryFallbackRows.forEach((row) => positions.push(row));
      }
      if (positions.length === 0 && topLevelTotalBalance > 0) {
        const bucket =
          detectedCustodian === 'Vanguard'
            ? classifyVanguardBucket(currentAccountName)
            : classifyFidelityBucket(currentAccountName);
        positions.push({
          custodian: `${detectedCustodian} (PDF)`,
          accountName: currentAccountName,
          accountNumber: currentAccountNumber,
          symbol: currentAccountName,
          description: `${currentAccountName} Total Balance`,
          value: topLevelTotalBalance,
          costBasis: topLevelTotalBalance * 0.6,
          bucket
        });
      }
    }

    if (positions.length === 0) {
      throw new Error(
        `${fileName}: Could not locate recognizable Fidelity or Vanguard holdings/account rows in the PDF. Ensure the PDF is an official Fidelity Investment Report or Vanguard Account Statement.`
      );
    }

    const totals = {
      Taxable: 0,
      'Pre-Tax': 0,
      Roth: 0,
      'Deferred Comp': 0,
      taxableCostBasis: 0
    };

    positions.forEach((pos) => {
      totals[pos.bucket] += pos.value;
      if (pos.bucket === 'Taxable') {
        totals.taxableCostBasis += pos.costBasis;
      }
    });

    return {
      fileName,
      format: detectedFormatLabel,
      positions,
      deferrals,
      totals
    };
  }

  async function parsePDFBuffer(arrayBuffer, fileName = 'Statement.pdf') {
    const pdfjsLib = global.pdfjsLib || global['pdfjs-dist/build/pdf'];
    if (!pdfjsLib) {
      throw new Error('PDF.js library is not loaded. Check your internet connection for CDN script.');
    }

    if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
    const pdfDoc = await loadingTask.promise;
    const allLines = [];

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();

      const rowsByY = [];
      for (const item of textContent.items) {
        const str = (item.str || '').trim();
        if (!str) continue;
        const x = item.transform ? item.transform[4] : 0;
        const y = item.transform ? item.transform[5] : 0;

        let matchedRow = rowsByY.find((r) => Math.abs(r.y - y) <= 2.8);
        if (!matchedRow) {
          matchedRow = { y, items: [] };
          rowsByY.push(matchedRow);
        }
        matchedRow.items.push({ x, str });
      }

      rowsByY.sort((a, b) => b.y - a.y);

      for (const row of rowsByY) {
        row.items.sort((a, b) => a.x - b.x);
        const lineText = row.items.map((it) => it.str).join(' ');
        if (lineText.trim()) {
          allLines.push(lineText.trim());
        }
      }
    }

    return parseExtractedPDFText(allLines, fileName);
  }

  function parseStatementFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('No file provided.'));
        return;
      }

      const fileName = file.name || 'Statement';
      const nameLower = fileName.toLowerCase();
      const isPdf = nameLower.endsWith('.pdf') || file.type === 'application/pdf';

      const reader = new FileReader();
      if (isPdf) {
        reader.onload = function (evt) {
          parsePDFBuffer(evt.target.result, fileName).then(resolve).catch(reject);
        };
        reader.onerror = function () {
          reject(new Error(`${fileName}: Failed to read PDF file via FileReader API.`));
        };
        reader.readAsArrayBuffer(file);
      } else {
        reader.onload = function (evt) {
          try {
            const content = String(evt.target.result || '');
            if (nameLower.endsWith('.json') || content.trim().startsWith('{') || content.trim().startsWith('[')) {
              resolve(parseJSONContent(content, fileName));
            } else {
              resolve(parseCSVContent(content, fileName));
            }
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = function () {
          reject(new Error(`${fileName}: Failed to read file via FileReader API.`));
        };
        reader.readAsText(file);
      }
    });
  }

  async function parseStatementFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) {
      throw new Error('No statement files selected.');
    }
    const results = [];
    const errors = [];

    for (const file of files) {
      try {
        const res = await parseStatementFile(file);
        results.push(res);
      } catch (err) {
        errors.push(err.message || String(err));
      }
    }

    return { results, errors };
  }

  global.StatementParser = {
    parseCSVContent,
    parseJSONContent,
    parseFidelityMultiAccountPDF,
    parseExtractedPDFText,
    parsePDFBuffer,
    parseStatementFile,
    parseStatementFiles
  };
})(window);
