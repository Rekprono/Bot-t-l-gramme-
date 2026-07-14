const request = require('supertest');
const assert = require('assert');
const app = require('./server');
const { db } = require('./db');

const { initDb } = require('./db');

describe('Mystique Shop Integration Tests', () => {

  // Initialize database before tests
  before(async () => {
    await initDb();
  });

  // Close database after tests
  after((done) => {
    db.close(done);
  });

  it('should retrieve settings successfully', (done) => {
    request(app)
      .get('/api/settings')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        assert.strictEqual(res.body.site_name, 'Mystique Shop');
        assert.strictEqual(res.body.contact_whatsapp, '+229 64 04 44 23');
        assert.strictEqual(res.body.contact_email, 'dah1bossou@gmail.com');
        done();
      });
  });

  it('should retrieve product details successfully', (done) => {
    request(app)
      .get('/api/product')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        assert.strictEqual(res.body.title, 'Bague Mystique de Richesse');
        assert(Array.isArray(res.body.sizes));
        assert(Array.isArray(res.body.colors));
        assert(Array.isArray(res.body.images));
        done();
      });
  });

  it('should check coupon successfully', (done) => {
    request(app)
      .post('/api/promo/check')
      .send({ code: 'MYSTIQUE15' })
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.discount_percent, 15);
        done();
      });
  });

  it('should reject invalid promo codes', (done) => {
    request(app)
      .post('/api/promo/check')
      .send({ code: 'INVALID999' })
      .expect(404)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        assert.strictEqual(res.body.success, undefined);
        done();
      });
  });

  it('should submit an order successfully', (done) => {
    request(app)
      .post('/api/orders/create')
      .send({
        customer_name: "Test User",
        whatsapp: "+22912345678",
        email: "test@example.com",
        country: "Bénin",
        city: "Cotonou",
        address: "Zongo, Cotonou",
        quantity: 1,
        color: "Or",
        size: "54",
        comment: "Vite s'il vous plait",
        payment_method: "cash"
      })
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.payment_required, false);
        assert(res.body.order_id);
        done();
      });
  });

  it('should submit an order with MoneyFusion and return WhatsApp redirect link', (done) => {
    request(app)
      .post('/api/orders/create')
      .send({
        customer_name: "Test WhatsApp User",
        whatsapp: "+22964044423",
        email: "test_wa@example.com",
        country: "Bénin",
        city: "Cotonou",
        address: "Zongo, Cotonou",
        quantity: 1,
        color: "Or",
        size: "54",
        comment: "Test redirect to WhatsApp",
        payment_method: "moneyfusion"
      })
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.payment_required, true);
        assert(res.body.payment_url.startsWith('https://wa.me/22964044423'));
        assert(res.body.payment_url.includes('Bague%20Mystique'));
        done();
      });
  });

});
