var test = require('node:test');
var assert = require('node:assert/strict');
var pricing = require('../lib/pricing');
var invoice = require('../lib/invoice');
var orders = require('../lib/orders');
var reports = require('../lib/reports');

// Follow the order route's pricing -> stored order path without loading the store.
function billedOrder(items, coupon) {
  var totals = pricing.computeTotals(items, coupon);
  return orders.add({ nextOrderId: 1, orders: [] }, {
    date: '15/11/2026', items: items, coupon: coupon,
    subtotal: totals.subtotal, discount: totals.discount,
    tax: totals.tax, total: totals.total
  });
}

// Synthetic carts reproduce the ticket amounts, without reading customer records.
test('ticket order #1002 invoice matches billing', function () {
  var order = billedOrder([
    { name: 'Synthetic 5% item', hsn: '1006', price: 1020, qty: 1 }
  ], 'SAVE10');
  order.id = 1002;
  order.date = '05/01/2022';
  assert.deepEqual([order.subtotal, order.discount, order.tax, order.total],
    [1020, 102, 45.9, 963.9]);
  var figures = invoice.computeInvoiceFigures(order);
  assert.deepEqual([figures.discount, figures.tax, figures.total],
    [102, 45.9, 963.9]);
  var recon = reports.getGstReconciliation({ orders: [order] });
  assert.equal(recon.rows[0].delta, 0);
  assert.equal(recon.rows[0].matched, true);
});

test('ticket order #1004 invoice respects coupon cap and groundnut oil GST', function () {
  var order = billedOrder([
    { name: 'Synthetic groundnut oil', hsn: '1508', price: 2240, qty: 1 }
  ], 'SAVE10');
  order.id = 1004;
  order.date = '30/01/2022';
  assert.deepEqual([order.subtotal, order.discount, order.tax, order.total],
    [2240, 150, 104.5, 2194.5]);
  var figures = invoice.computeInvoiceFigures(order);
  assert.deepEqual([figures.discount, figures.tax, figures.total],
    [150, 104.5, 2194.5]);
  assert.equal(figures.rows[0].gstPercent, 5);
  assert.equal(reports.getGstReconciliation({ orders: [order] }).rows[0].delta, 0);
});

test('no-coupon invoices match 5 and 12 percent HSN items', function () {
  [
    { hsn: '1006', tax: 5, total: 105, delta: 13 },
    { hsn: '0405', tax: 12, total: 112, delta: 6 }
  ].forEach(function (example) {
    var order = billedOrder([
      { name: 'Synthetic item', hsn: example.hsn, price: 100, qty: 1 }
    ], '');
    assert.deepEqual([order.tax, order.total], [example.tax, example.total]);
    var figures = invoice.computeInvoiceFigures(order);
    assert.deepEqual([figures.discount, figures.tax, figures.total], [0, example.tax, example.total]);
    var row = reports.getGstReconciliation({ orders: [order] }).rows[0];
    assert.equal(row.delta, 0);
    assert.equal(row.matched, true);
  });
});

test('invoice and ledger agree for default GST without a coupon', function () {
  var order = billedOrder([{ name: 'Tea', hsn: '0902', price: 100, qty: 2 }], '');
  assert.deepEqual(invoice.computeInvoiceFigures(order), {
    subtotal: 200, discount: 0, tax: 36, cgst: 18, sgst: 18, total: 236,
    rows: [{ name: 'Tea', sku: '-', hsn: '0902', qty: 2, price: 100,
      gstPercent: 18, line: 200, lineTax: 36 }]
  });
  assert.equal(order.total, 236);
  assert.equal(reports.getGstReconciliation({ orders: [order] }).mismatchCount, 0);
  assert.doesNotMatch(invoice.render(order), /Accountant Reconciliation Notice/);
});

test('mixed HSN invoice GST uses post-discount 5 and 12 percent slabs', function () {
  var order = billedOrder([
    { name: 'Rice', hsn: '1006', price: 400, qty: 1 },
    { name: 'Ghee', hsn: '0405', price: 100, qty: 1 }
  ], 'SAVE10');
  assert.deepEqual([order.subtotal, order.discount, order.tax, order.total], [500, 50, 28.8, 478.8]);
  var figures = invoice.computeInvoiceFigures(order);
  assert.deepEqual([figures.subtotal, figures.discount, figures.tax,
    figures.cgst, figures.sgst, figures.total], [500, 50, 28.8, 14.4, 14.4, 478.8]);
  assert.deepEqual(figures.rows.map(function (row) {
    return [row.gstPercent, row.lineTax];
  }), [[5, 18], [12, 10.8]]);
  assert.deepEqual(reports.getGstReconciliation({ orders: [order] }).rows[0], {
    orderId: 1, date: '15/11/2026', customer: 'Walk-in', coupon: 'SAVE10',
    ledgerSubtotal: 500, ledgerDiscount: 50, ledgerTax: 28.8, ledgerTotal: 478.8,
    invoiceDiscount: 50, invoiceTax: 28.8, invoiceTotal: 478.8, delta: 0, matched: true
  });
  var html = invoice.render(order);
  assert.match(html, /Invoice Total<\/td><td class="r">₹478\.80/);
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
});

test('invoice respects percent coupon cap and independently recomputes stored figures', function () {
  var order = billedOrder([{ name: 'Tea', price: 2000, qty: 1 }], 'SAVE10');
  assert.deepEqual([order.discount, order.tax, order.total], [150, 333, 2183]);
  var figures = invoice.computeInvoiceFigures(order);
  assert.deepEqual([figures.discount, figures.tax, figures.total], [150, 333, 2183]);
  order.subtotal = 1;
  order.discount = 2;
  order.tax = 3;
  order.total = 4;
  assert.deepEqual(invoice.computeInvoiceFigures(order), figures);
});

test('percent coupon invoice matches both total and GST', function () {
  var order = billedOrder([{ name: 'Tea', price: 500, qty: 1 }], 'SAVE10');
  assert.deepEqual([order.discount, order.tax, order.total], [50, 81, 531]);
  var figures = invoice.computeInvoiceFigures(order);
  assert.deepEqual([figures.discount, figures.tax, figures.total], [50, 81, 531]);
  var recon = reports.getGstReconciliation({ orders: [order] });
  assert.equal(recon.mismatchCount, 0);
  assert.equal(recon.totalDelta, 0);
  assert.equal(recon.rows[0].delta, 0);
  assert.equal(recon.rows[0].matched, true);
  assert.doesNotMatch(invoice.render(order), /Accountant Reconciliation Notice/);
});

test('flat coupon reduces invoice taxable amount before GST', function () {
  var order = billedOrder([{ name: 'Tea', price: 300, qty: 1 }], 'FLAT50');
  assert.deepEqual([order.discount, order.tax, order.total], [50, 45, 295]);
  var figures = invoice.computeInvoiceFigures(order);
  assert.deepEqual([figures.discount, figures.tax, figures.total], [50, 45, 295]);
});

test('direct invoice calculation applies coupon normalization, minimums, expiry and subtotal clamp', function () {
  // These are direct module inputs; the HTTP order route rejects invalid coupons.
  [
    { code: ' save10 ', price: 500, discount: 50, total: 531 },
    { code: 'SAVE10', price: 100, discount: 0, total: 118 },
    { code: 'DIWALI20', price: 1000, discount: 0, total: 1180 },
    { code: 'FLAT50', price: 10, discount: 0, total: 11.8 }
  ].forEach(function (example) {
    var figures = invoice.computeInvoiceFigures({ coupon: example.code,
      items: [{ name: 'Tea', price: example.price, qty: 1 }] });
    assert.equal(figures.discount, example.discount, example.code);
    assert.equal(figures.total, example.total, example.code);
  });
});

test('invoice and pricing agree on zero, decimal and percent GST overrides', function () {
  [
    { rate: 0, billedTax: 0, invoiceTax: 0, percent: 0 },
    { rate: 0.12, billedTax: 12, invoiceTax: 12, percent: 12 },
    { rate: 12, billedTax: 12, invoiceTax: 12, percent: 12 }
  ].forEach(function (example) {
    var order = billedOrder([{ name: 'Item', price: 100, qty: 1, gstRate: example.rate }], '');
    var figures = invoice.computeInvoiceFigures(order);
    assert.equal(order.tax, example.billedTax);
    assert.equal(figures.tax, example.invoiceTax);
    assert.equal(figures.rows[0].gstPercent, example.percent);
  });
});

test('invoice sums rounded line GST consistently with pricing', function () {
  var order = billedOrder([
    { name: 'A', price: 0.03, qty: 1 },
    { name: 'B', price: 0.03, qty: 1 }
  ], '');
  assert.deepEqual([order.tax, order.total], [0.02, 0.08]);
  var figures = invoice.computeInvoiceFigures(order);
  assert.deepEqual(figures.rows.map(function (row) { return row.lineTax; }), [0.01, 0.01]);
  assert.deepEqual([figures.tax, figures.cgst, figures.sgst, figures.total], [0.02, 0.01, 0.01, 0.08]);
  assert.equal(reports.getGstReconciliation({ orders: [order] }).rows[0].matched, true);
  assert.doesNotMatch(invoice.render(order), /Accountant Reconciliation Notice/);
});

test('CURRENT BEHAVIOUR: reconciliation includes pending orders, skips cancelled and sums absolute total differences', function () {
  var higher = billedOrder([{ name: 'Rice', hsn: '1006', price: 100, qty: 1 }], '');
  var lower = billedOrder([{ name: 'Tea', price: 2000, qty: 1 }], 'SAVE10');
  higher.total = 92;
  lower.total = 2242;
  higher.status = 'pending';
  lower.id = 2;
  var cancelled = Object.assign({}, higher, { id: 3, status: 'cancelled' });
  var recon = reports.getGstReconciliation({ orders: [higher, lower, cancelled] });
  assert.equal(recon.totalChecked, 2);
  assert.equal(recon.mismatchCount, 2);
  assert.deepEqual(recon.rows.map(function (row) { return row.delta; }), [13, -59]);
  assert.equal(recon.totalDelta, 72);
});
