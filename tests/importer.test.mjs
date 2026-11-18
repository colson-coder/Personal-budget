// Unit tests for js/importer.js. Run with: node tests/importer.test.mjs
import assert from 'node:assert/strict';
import {
  detectDelimiter, parseDelimited, isOFX, parseOFX, parseAmount, detectDateOrder, parseDate,
  guessColumns, merchantKey, layoutKey,
} from '../js/importer.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('✓', name); };

test('detects comma, semicolon and tab separators', () => {
  assert.equal(detectDelimiter('a,b,c\n1,2,3\n4,5,6'), ',');
  assert.equal(detectDelimiter('Datum;Betrag;Text\n05.11.2026;-12,50;Rewe\n06.11.2026;3.000,00;Gehalt'), ';');
  assert.equal(detectDelimiter('Date\tAmount\tDesc\n2026-11-01\t-5\tx'), '\t');
});

test('skips junk lines above the header and handles quotes/BOM', () => {
  const csv = '﻿Account: 1234\nStatement Nov 2026\nDate,Description,Amount\n2026-11-02,"Coffee, large",-4.50\n2026-11-03,"He said ""hi""",10';
  const p = parseDelimited(csv);
  assert.deepEqual(p.headers, ['Date', 'Description', 'Amount']);
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[0][1], 'Coffee, large');
  assert.equal(p.rows[1][1], 'He said "hi"');
});

test('parses amounts in every common format', () => {
  const cases = [
    ['1,234.56', 1234.56], ['1.234,56', 1234.56], ['-12.50', -12.5], ['(12.50)', -12.5],
    ['12.50-', -12.5], ['$1,200', 1200], ['€ 3.000,00', 3000], ['12,50', 12.5], ['1,234', 1234],
    ['45.00 CR', 45], ['45.00 DR', -45], ['−7.25', -7.25], ['', NaN], ['abc', NaN],
  ];
  for (const [raw, want] of cases) {
    const got = parseAmount(raw);
    if (Number.isNaN(want)) assert.ok(Number.isNaN(got), raw); else assert.equal(got, want, raw);
  }
});

test('detects day/month order from the whole file', () => {
  assert.equal(detectDateOrder(['01/02/2026', '25/02/2026']), 'dmy');
  assert.equal(detectDateOrder(['02/01/2026', '02/25/2026']), 'mdy');
  assert.equal(detectDateOrder(['05.11.2026']), 'dmy');
  assert.equal(detectDateOrder(['05/11/2026']), 'mdy');
});

test('parses many date formats', () => {
  assert.equal(parseDate('2026-11-05'), '2026-11-05');
  assert.equal(parseDate('2026-11-05T10:22:00Z'), '2026-11-05');
  assert.equal(parseDate('2026/11/05'), '2026-11-05');
  assert.equal(parseDate('20261105'), '2026-11-05');
  assert.equal(parseDate('11/05/2026', 'mdy'), '2026-11-05');
  assert.equal(parseDate('05/11/2026', 'dmy'), '2026-11-05');
  assert.equal(parseDate('05.11.26', 'dmy'), '2026-11-05');
  assert.equal(parseDate('05-Nov-2026'), '2026-11-05');
  assert.equal(parseDate('5 November 2026'), '2026-11-05');
  assert.equal(parseDate('Nov 5, 2026'), '2026-11-05');
  assert.equal(parseDate('31/02/2026', 'dmy'), '');
  assert.equal(parseDate('not a date'), '');
});

test('parses OFX/QFX bank downloads', () => {
  const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261103120000<TRNAMT>-42.10<FITID>A1<NAME>WHOLE FOODS &amp; CO<MEMO>POS 1234
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261101<TRNAMT>2500.00<FITID>A2<NAME>ACME PAYROLL
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  assert.ok(isOFX(ofx));
  const p = parseOFX(ofx);
  assert.equal(p.rows.length, 2);
  assert.deepEqual(p.rows[0].slice(0, 4), ['2026-11-03', '-42.10', 'USD', 'WHOLE FOODS & CO']);
  assert.equal(p.rows[1][0], '2026-11-01');
});

test('guesses columns, including separate money in / out', () => {
  assert.deepEqual(guessColumns(['Date', 'Description', 'Amount', 'Currency']),
    { date: 0, amount: 2, out: -1, in: -1, currency: 3, description: 1, category: -1 });
  const g = guessColumns(['Posting Date', 'Details', 'Debit', 'Credit', 'Balance']);
  assert.equal(g.date, 0); assert.equal(g.description, 1); assert.equal(g.out, 2); assert.equal(g.in, 3); assert.equal(g.amount, -1);
  const de = guessColumns(['Buchungstag', 'Verwendungszweck', 'Betrag', 'Währung']);
  assert.deepEqual([de.date, de.description, de.amount, de.currency, de.category], [0, 1, 2, 3, -1]);
  const fr = guessColumns(['Date opération', 'Libellé', 'Montant']);
  assert.deepEqual([fr.date, fr.description, fr.amount], [0, 1, 2]);
  const es = guessColumns(['Fecha', 'Concepto', 'Importe']);
  assert.deepEqual([es.date, es.description, es.amount], [0, 1, 2]);
});

test('merchant keys ignore numbers and card noise', () => {
  assert.equal(merchantKey('UBER *TRIP 8XK2 SAN JOSE 11/05'), 'uber trip san');
  assert.equal(merchantKey('POS PURCHASE NETFLIX.COM 866-579'), 'netflix com');
  assert.equal(merchantKey('Netflix.com'), 'netflix com');
  assert.equal(layoutKey(['Date', ' Amount ']), 'date|amount');
});

console.log(`\n${passed} tests passed`);
