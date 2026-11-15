var test = require('node:test');
var assert = require('node:assert/strict');
var invoice = require('../lib/invoice');

test('ticket #1002 invoice matches billed total and post-discount HSN GST', function () {
  var order = {
    id: 1002, date: '05/01/2022', coupon: 'SAVE10',
    items: [{ name: 'Synthetic rice', hsn: '1006', price: 1020, qty: 1 }],
    subtotal: 1020, discount: 102, tax: 45.9, total: 963.9
  };
  var figures = invoice.computeInvoiceFigures(order);
  assert.equal(figures.total, 963.9);
  assert.equal(figures.discount, 102);
  assert.equal(figures.tax, 45.9);
  assert.equal(figures.cgst, 22.95);
  assert.equal(figures.sgst, 22.95);
  assert.equal(figures.rows[0].gstPercent, 5);
  assert.equal(figures.rows[0].lineTax, 45.9);
  assert.match(invoice.render(order), /Invoice Total<\/td><td class="r">₹963\.90/);
  assert.doesNotMatch(invoice.render(order), /Accountant Reconciliation Notice/);
});
