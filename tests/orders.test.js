var test = require('node:test');
var assert = require('node:assert/strict');
var inventory = require('../lib/inventory');
var orders = require('../lib/orders');
var ledger = require('../lib/ledger');
var dates = require('../lib/dates');

function fixture() {
  return {
    nextOrderId: 1001, nextSettlementId: 501, orders: [], settlements: [],
    products: [{ id: 1, name: 'Rice', stock: 10, reserved: 2 }],
    customers: [{ id: 1, name: 'Example', creditLimit: 500,
      openingBalance: 100, totalBilled: 200, totalSettled: 50 }]
  };
}

test('stock excludes reservations and currently rejects the last sellable unit', function () {
  var db = fixture();
  assert.equal(inventory.getSellableStock(db.products[0]), 8);
  assert.deepEqual(inventory.check(db.products, [{ id: '1', qty: 7 }]), { ok: true });
  assert.deepEqual(inventory.check(db.products, [{ id: 1, qty: 8 }]), {
    ok: false, msg: 'Rice is out of stock (8 sellable available)'
  });
  assert.equal(inventory.getSellableStock({ stock: 1, reserved: 2 }), 0);
});

test('reservation deducts physical stock; quote release only reduces held stock', function () {
  var db = fixture();
  inventory.reserve(db.products, [{ id: 1, qty: 3 }]);
  assert.deepEqual(db.products[0], { id: 1, name: 'Rice', stock: 7, reserved: 2 });
  inventory.release(db.products, [{ productId: 1, qty: 3 }]);
  assert.deepEqual(db.products[0], { id: 1, name: 'Rice', stock: 7, reserved: 0 });
});

test('khata accepts the exact credit limit and rejects excess without mutation', function () {
  var db = fixture();
  assert.equal(ledger.chargeOrderToKhata(db, '1', 250).ok, true);
  assert.equal(db.customers[0].balance, 500);
  var before = JSON.stringify(db);
  assert.deepEqual(ledger.chargeOrderToKhata(db, 1, 0.01), {
    ok: false,
    error: 'Khata credit limit exceeded for Example (Limit: ₹500, Projected: ₹500.01)'
  });
  assert.equal(JSON.stringify(db), before);
});

test('settlement permits overpayment and defaults its mode and note', function () {
  var db = fixture();
  assert.equal(ledger.recordSettlement(db, 1, 0).ok, false);
  var result = ledger.recordSettlement(db, 1, 300);
  assert.equal(result.ok, true);
  assert.equal(result.customer.balance, -50);
  assert.equal(result.settlement.id, 501);
  assert.equal(result.settlement.mode, 'upi');
  assert.equal(result.settlement.note, 'Khata settlement');
  assert.equal(db.settlements[0], result.settlement);
  assert.equal(db.nextSettlementId, 502);
});

test('current browser-style string settlement concatenates with the settled total', function () {
  var db = fixture();
  var result = ledger.recordSettlement(db, 1, '25');
  assert.equal(result.ok, true);
  assert.equal(result.settlement.amount, 25);
  assert.equal(result.customer.totalSettled, '5025');
  assert.equal(result.customer.balance, -4725);
});

test('cancellation reverses khata once but currently leaves standard item stock unchanged', function () {
  var db = fixture();
  var order = orders.add(db, { date: '15/11/2026', paymentMode: 'khata',
    customerId: 1, total: 100, items: [{ id: 1, qty: 3 }] });
  assert.equal(order.id, 1001);
  assert.equal(db.nextOrderId, 1002);
  inventory.reserve(db.products, order.items);
  assert.equal(orders.cancel(db, '1001', 'Duplicate').ok, true);
  assert.equal(order.status, 'cancelled');
  assert.equal(order.cancelReason, 'Duplicate');
  assert.match(order.cancelledAt, /^\d{2}\/\d{2}\/\d{4}$/);
  assert.equal(db.customers[0].totalBilled, 100);
  assert.equal(db.customers[0].balance, 150);
  assert.equal(db.products[0].stock, 7);
  assert.equal(db.products[0].reserved, 2);
  var before = JSON.stringify(db);
  assert.deepEqual(orders.cancel(db, 1001), {
    ok: false, error: 'Order #1001 is already cancelled'
  });
  assert.equal(JSON.stringify(db), before);
  assert.deepEqual(orders.cancel(db, 999), { ok: false, error: 'Order not found' });
});

test('order search combines customer or coupon matching with status', function () {
  var db = { orders: [
    { id: 1, date: '10/11/2026', customer: 'Example', coupon: 'SAVE10' },
    { id: 2, date: '11/11/2026', customer: 'Other', status: 'cancelled' }
  ] };
  assert.deepEqual(orders.list(db, { search: ' save10 ', status: 'completed' }), [db.orders[0]]);
  assert.deepEqual(orders.list(db, { search: 'OTHER', status: 'completed' }), []);
});

test('current date filtering and sorting use day-first lexical order across months', function () {
  var db = { orders: [
    { id: 1, date: '31/01/2026' }, { id: 2, date: '01/02/2026' }
  ] };
  assert.equal(dates.normalizeDateKey('2026-02-01'), '01/02/2026');
  assert.deepEqual(orders.list(db).map(function (o) { return o.id; }), [1, 2]);
  assert.deepEqual(orders.list(db, { to: '2026-02-01' }), [db.orders[1]]);
  assert.equal(dates.getFiscalYear('2026-03-31'), 'FY25-26');
  assert.equal(dates.getFiscalYear('2026-04-01'), 'FY26-27');
});
