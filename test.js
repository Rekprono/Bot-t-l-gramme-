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

  it('should submit a simplified order successfully and default to Maketou/WhatsApp redirection for real payments', (done) => {
    request(app)
      .post('/api/orders/create')
      .send({
        customer_name: "Simplice Gnanhoué",
        whatsapp: "+22995959595",
        country: "Bénin",
        address: "Ménontin, Cotonou"
      })
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.payment_required, true);
        // Defaults to Maketou which has fallback to WhatsApp or simulation
        assert(res.body.payment_url.includes('wa.me') || res.body.payment_url.includes('maketou'));
        assert(res.body.order_id);
        done();
      });
  });

  it('should reject order if any of the 4 required fields are missing', (done) => {
    request(app)
      .post('/api/orders/create')
      .send({
        customer_name: "Simplice Gnanhoué",
        whatsapp: "+22995959595"
        // missing country and address
      })
      .expect(400)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        assert.strictEqual(res.body.success, undefined);
        assert(res.body.error.includes("obligatoires"));
        done();
      });
  });

  it('should simulate successful Maketou payment on a simplified order and update status', (done) => {
    request(app)
      .post('/api/orders/create')
      .send({
        customer_name: "Test Streamlined Pay",
        whatsapp: "+22964044423",
        country: "Bénin",
        address: "Zongo, Cotonou",
        payment_method: "maketou"
      })
      .end((err, res) => {
        if (err) return done(err);
        const orderId = res.body.order_id;

        request(app)
          .post('/api/payments/maketou/simulate')
          .send({
            orderId: orderId,
            status: 'SUCCESS',
            amount: '25000',
            payment_gateway: 'wave'
          })
          .expect(200)
          .end((err, resSim) => {
            if (err) return done(err);
            assert.strictEqual(resSim.body.success, true);
            assert(resSim.body.paymentId.startsWith('MT-'));

            request(app)
              .get(`/api/orders/track/${orderId}`)
              .expect(200)
              .end((err, resTrack) => {
                if (err) return done(err);
                assert.strictEqual(resTrack.body.payment_status, 'Payé');
                assert.strictEqual(resTrack.body.status, 'En cours de préparation');
                done();
              });
          });
      });
  });

});
