var test = require('node:test');
var assert = require('node:assert/strict');
var pricing = require('../lib/pricing');
var tax = require('../lib/tax');
var coupons = require('../lib/coupons');
var invoice = require('../lib/invoice');
var reports = require('../lib/reports');

test('coupons normalize codes, enforce minimums, and cap discounts', function () {
  assert.equal(coupons.normalizeCode(' save10 '), 'SAVE10');
  assert.equal(coupons.calculateDiscount(499, 'SAVE10'), 0);
  assert.equal(coupons.calculateDiscount(500, 'SAVE10'), 50);
  assert.equal(coupons.calculateDiscount(2000, 'SAVE10'), 150);
  assert.equal(coupons.calculateDiscount(300, 'FLAT50'), 50);
  assert.deepEqual(coupons.validate('', 0), { valid: true, code: '', discount: 0 });
});

test('invalid and expired coupons produce distinct errors', function () {
  assert.deepEqual(coupons.validate(' missing ', 1000), {
    valid: false, error: 'Invalid coupon code: MISSING'
  });
  assert.deepEqual(coupons.validate('DIWALI20', 1000), {
    valid: false, error: 'Coupon DIWALI20 has expired'
  });
  assert.equal(coupons.calculateDiscount(1000, 'DIWALI20'), 0);
});

test('GST accepts numeric overrides and currently matches HSN exactly, not by prefix', function () {
  assert.equal(tax.getRateForItem({ hsn: '1006' }), 0.05);
  assert.equal(tax.getRateForItem({ hsn: '100630' }), 0.18);
  assert.equal(tax.getRateForItem({ hsn: '1006', gstRate: 12 }), 0.12);
  assert.equal(tax.getRateForItem({ gstRate: 0.12 }), 0.12);
  assert.equal(tax.getRateForItem({ gstRate: 0 }), 0);
  assert.deepEqual(tax.splitCgstSgst(0.05), { cgst: 0.03, sgst: 0.02 });
});

test('pricing apportions discounts before applying mixed GST slabs', function () {
  var result = pricing.computeTotals([
    { id: 1, name: 'Rice', hsn: '1006', price: 400, qty: 1 },
    { id: 2, name: 'Ghee', hsn: '0405', price: 100, qty: 1 }
  ], 'SAVE10');
  assert.deepEqual(result, {
    subtotal: 500, discount: 50, taxable: 450, tax: 28.8,
    cgst: 14.4, sgst: 14.4, total: 478.8,
    lines: [
      { id: 1, name: 'Rice', hsn: '1006', gstPercent: 5,
        gross: 400, discount: 40, taxable: 360, tax: 18, net: 378 },
      { id: 2, name: 'Ghee', hsn: '0405', gstPercent: 12,
        gross: 100, discount: 10, taxable: 90, tax: 10.8, net: 100.8 }
    ]
  });
});

test('empty carts produce zero totals even with a coupon', function () {
  assert.deepEqual(pricing.computeTotals([], 'SAVE10'), {
    subtotal: 0, discount: 0, taxable: 0, tax: 0,
    cgst: 0, sgst: 0, total: 0, lines: []
  });
});

test('invoice respects HSN and coupon cap; reconciliation matches', function () {
  var order = {
    id: 1, items: [{ name: 'Rice', hsn: '1006', price: 2000, qty: 1 }],
    coupon: 'SAVE10', subtotal: 2000, discount: 150, tax: 92.5, total: 1942.5
  };
  var figures = invoice.computeInvoiceFigures(order);
  assert.equal(figures.tax, 92.5);
  assert.equal(figures.discount, 150);
  assert.equal(figures.total, 1942.5);
  var result = reports.getGstReconciliation({ orders: [order,
    Object.assign({}, order, { id: 2, status: 'cancelled' })] });
  assert.equal(result.totalChecked, 1);
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.totalDelta, 0);
  assert.equal(result.rows[0].matched, true);
});
