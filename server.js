const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { db, initDb, hashPassword } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and body parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Express session setup
app.use(session({
  secret: 'mystique-shop-secret-key-super-secure',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to protect admin routes
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  return res.status(401).json({ error: "Non autorisé. Veuillez vous connecter." });
}

// -------------------------------------------------------------
// PUBLIC API ENDPOINTS
// -------------------------------------------------------------

// Get site settings
app.get('/api/settings', (req, res) => {
  db.all("SELECT key, value FROM settings", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: "Erreur lors de la récupération des paramètres." });
    }
    const settingsObj = {};
    rows.forEach(r => {
      settingsObj[r.key] = r.value;
    });
    res.json(settingsObj);
  });
});

// Get active products (the Mystic Ring)
app.get('/api/product', (req, res) => {
  db.get("SELECT * FROM products WHERE id = 1", [], (err, product) => {
    if (err) {
      return res.status(500).json({ error: "Erreur lors de la récupération du produit." });
    }
    if (!product) {
      return res.status(404).json({ error: "Produit introuvable." });
    }
    // Parse arrays
    res.json({
      ...product,
      sizes: product.sizes ? product.sizes.split(',') : [],
      colors: product.colors ? product.colors.split(',') : [],
      images: product.images ? product.images.split(',') : []
    });
  });
});

// Get active testimonials
app.get('/api/testimonials', (req, res) => {
  db.all("SELECT * FROM testimonials WHERE status = 'active' ORDER BY id DESC", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: "Erreur lors de la récupération des témoignages." });
    }
    res.json(rows);
  });
});

// Submit a new testimonial
app.post('/api/testimonials/submit', (req, res) => {
  const { name, comment, rating } = req.body;
  if (!name || !comment) {
    return res.status(400).json({ error: "Nom et commentaire requis." });
  }
  const stars = Math.min(Math.max(parseInt(rating) || 5, 1), 5);
  // Custom user avatar generated randomly based on name
  const avatar = `https://randomuser.me/api/portraits/lego/${Math.floor(Math.random() * 9)}.jpg`;

  db.run(`INSERT INTO testimonials (name, comment, rating, avatar, status) VALUES (?, ?, ?, ?, 'pending')`,
    [name, comment, stars, avatar],
    function(err) {
      if (err) {
        return res.status(500).json({ error: "Erreur lors de la soumission." });
      }
      res.json({ success: true, message: "Témoignage envoyé avec succès ! Il sera affiché après modération.", id: this.lastID });
    }
  );
});

// Check promotion code
app.post('/api/promo/check', (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: "Code requis." });
  }
  db.get("SELECT discount_percent FROM promotions WHERE code = ? AND active = 1", [code.trim().toUpperCase()], (err, row) => {
    if (err) {
      return res.status(500).json({ error: "Erreur serveur." });
    }
    if (!row) {
      return res.status(404).json({ error: "Code promo invalide ou expiré." });
    }
    res.json({ success: true, discount_percent: row.discount_percent });
  });
});

// Track an order
app.get('/api/orders/track/:id', (req, res) => {
  const orderId = req.params.id;
  db.get("SELECT id, customer_name, quantity, color, size, total_price, status, payment_status, created_at FROM orders WHERE id = ?", [orderId], (err, order) => {
    if (err) {
      return res.status(500).json({ error: "Erreur de base de données." });
    }
    if (!order) {
      return res.status(404).json({ error: "Commande introuvable." });
    }
    res.json(order);
  });
});

// Submit a new order
app.post('/api/orders/create', (req, res) => {
  const {
    customer_name,
    whatsapp,
    email,
    country,
    city,
    address,
    quantity,
    color,
    size,
    comment,
    promo_code,
    payment_method // 'cash' or 'moneyfusion'
  } = req.body;

  if (!customer_name || !whatsapp || !email || !country || !city || !address || !quantity || !color || !size) {
    return res.status(400).json({ error: "Veuillez remplir tous les champs obligatoires." });
  }

  // Get pricing details from DB or settings
  db.get("SELECT price, promo_price FROM products WHERE id = 1", [], (err, product) => {
    if (err || !product) {
      return res.status(500).json({ error: "Erreur de base de données lors de la tarification." });
    }

    db.all("SELECT key, value FROM settings", [], (err, settingsRows) => {
      if (err) {
        return res.status(500).json({ error: "Erreur serveur de paramètres." });
      }

      const settings = {};
      settingsRows.forEach(r => settings[r.key] = r.value);

      // Default calculations (supports FCFA/EUR depending on settings)
      // Check if price in FCFA is configured
      const basePrice = parseFloat(settings.promo_price_fcfa || "49000");
      let total = basePrice * parseInt(quantity);

      // Apply coupon if valid
      const processOrder = (finalPrice) => {
        const payment_status = (payment_method === 'moneyfusion') ? 'En attente de paiement' : 'En attente';
        const status = 'Reçue';

        db.run(`INSERT INTO orders (
          customer_name, whatsapp, email, country, city, address, quantity, color, size, comment,
          total_price, promo_code, status, payment_status, payment_method, payment_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          customer_name, whatsapp, email, country, city, address, parseInt(quantity), color, size, comment || "",
          finalPrice, promo_code || "", status, payment_status, payment_method || 'moneyfusion', ""
        ],
        function(err) {
          if (err) {
            console.error("Order creation database error:", err);
            return res.status(500).json({ error: "Erreur lors de l'enregistrement de la commande." });
          }

          const orderId = this.lastID;

          // Simulate sending notifications (Email & WhatsApp)
          console.log(`[NOTIFICATION OUTBOX - EMAIL] To: ${email}, dah1bossou@gmail.com`);
          console.log(`Subject: Confirmation de Commande #${orderId} - Mystique Shop`);
          console.log(`Body: Bonjour ${customer_name}, votre commande pour la Bague Mystique de Richesse (#${orderId}) a bien été enregistrée ! Quantité: ${quantity}, Couleur: ${color}, Taille: ${size}. Total: ${finalPrice} FCFA.`);

          console.log(`[NOTIFICATION OUTBOX - WHATSAPP] To: ${whatsapp}, +229 64 04 44 23`);
          console.log(`Message: Bonjour, la commande #${orderId} de ${customer_name} (${whatsapp}) a été enregistrée. Produit: Bague Mystique de Richesse, Quantité: ${quantity}, Couleur: ${color}, Taille: ${size}. Statut de paiement: ${payment_status}.`);

          // If moneyfusion is selected, redirect to WhatsApp for payment as requested
          if (payment_method === 'moneyfusion') {
            const encodedMsg = encodeURIComponent(
              `Bonjour, je souhaite finaliser le paiement de ma commande #${orderId} de la Bague Mystique de Richesse.\n` +
              `Nom: ${customer_name}\n` +
              `Téléphone: ${whatsapp}\n` +
              `Article: Bague Mystique (${quantity}x, ${color}, Taille ${size})\n` +
              `Total: ${finalPrice} FCFA.`
            );
            const paymentUrl = `https://wa.me/22964044423?text=${encodedMsg}`;
            return res.json({
              success: true,
              order_id: orderId,
              payment_required: true,
              payment_url: paymentUrl,
              message: "Commande créée ! Redirection vers WhatsApp pour effectuer le paiement..."
            });
          }

          res.json({
            success: true,
            order_id: orderId,
            payment_required: false,
            message: "Votre commande a été enregistrée avec succès ! Notre équipe va vous contacter via WhatsApp sous peu."
          });
        });
      };

      if (promo_code) {
        db.get("SELECT discount_percent FROM promotions WHERE code = ? AND active = 1", [promo_code.trim().toUpperCase()], (err, promo) => {
          if (!err && promo) {
            const discount = (total * promo.discount_percent) / 100;
            total = total - discount;
          }
          processOrder(total);
        });
      } else {
        processOrder(total);
      }
    });
  });
});

// -------------------------------------------------------------
// MONEYFUSION PAY SIMULATOR & WEBHOOK
// -------------------------------------------------------------

// Interactive simulator view for MoneyFusion payment
app.get('/pay/moneyfusion/:id', (req, res) => {
  const orderId = req.params.id;
  const amount = req.query.amount || '49000';

  db.get("SELECT * FROM orders WHERE id = ?", [orderId], (err, order) => {
    if (err || !order) {
      return res.status(404).send("<h2>Commande introuvable.</h2>");
    }

    // Serve a simple beautiful simulation page for MoneyFusion Pay
    res.send(`
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>MoneyFusion Pay - Simulation</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
      </head>
      <body class="bg-gray-950 text-white min-h-screen flex items-center justify-center p-4">
        <div class="bg-gray-900 border border-yellow-600/30 rounded-2xl p-6 max-w-md w-full shadow-2xl relative overflow-hidden">
          <div class="absolute -top-10 -right-10 w-32 h-32 bg-yellow-500/10 rounded-full blur-2xl"></div>

          <div class="flex items-center justify-between mb-6 border-b border-gray-800 pb-4">
            <div class="flex items-center gap-2">
              <span class="text-yellow-500 text-2xl font-bold"><i class="fa-solid fa-fire"></i> MoneyFusion</span>
              <span class="bg-yellow-500/20 text-yellow-400 text-xs px-2 py-0.5 rounded-full font-semibold">Pay</span>
            </div>
            <div class="text-right">
              <p class="text-xs text-gray-400">Commande #${orderId}</p>
            </div>
          </div>

          <div class="mb-6">
            <p class="text-sm text-gray-400">Montant à régler :</p>
            <p class="text-3xl font-bold text-yellow-500">${amount} <span class="text-sm font-normal text-white">FCFA</span></p>

            <div class="mt-4 bg-gray-950/50 p-4 rounded-xl border border-gray-800">
              <p class="text-xs text-gray-400 mb-1">Bénéficiaire :</p>
              <p class="font-semibold text-sm">Mystique Shop (dah1bossou@gmail.com)</p>
              <p class="text-xs text-gray-400 mt-2 mb-1">Client :</p>
              <p class="font-semibold text-sm">${order.customer_name} (${order.whatsapp})</p>
            </div>
          </div>

          <p class="text-xs text-gray-400 mb-6 text-center italic">
            <i class="fa-solid fa-lock text-yellow-500"></i> Environnement de test sécurisé MoneyFusion.
          </p>

          <div class="flex flex-col gap-3">
            <button onclick="triggerPayment('SUCCESS')" class="w-full bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-400 hover:to-yellow-500 text-black font-bold py-3 px-4 rounded-xl shadow-lg transition duration-300 transform active:scale-95 flex items-center justify-center gap-2">
              <i class="fa-solid fa-circle-check"></i> Simuler Paiement Réussi
            </button>
            <button onclick="triggerPayment('FAILED')" class="w-full bg-red-600/20 hover:bg-red-600/30 border border-red-500/50 text-red-400 font-semibold py-3 px-4 rounded-xl transition duration-300 flex items-center justify-center gap-2">
              <i class="fa-solid fa-circle-xmark"></i> Simuler Échec du Paiement
            </button>
            <a href="/" class="text-center text-xs text-gray-500 hover:text-gray-300 transition mt-2">Annuler et retourner à la boutique</a>
          </div>
        </div>

        <script>
          function triggerPayment(status) {
            fetch('/api/payments/moneyfusion/simulate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ orderId: "${orderId}", status: status, amount: "${amount}" })
            })
            .then(res => res.json())
            .then(data => {
              if (data.success) {
                if (status === 'SUCCESS') {
                  window.location.href = '/payment-success.html?orderId=${orderId}';
                } else {
                  window.location.href = '/payment-failed.html?orderId=${orderId}';
                }
              } else {
                alert("Erreur de simulation: " + data.error);
              }
            })
            .catch(err => {
              alert("Erreur de communication.");
            });
          }
        </script>
      </body>
      </html>
    `);
  });
});

// Simulation endpoint for test webhook triggering
app.post('/api/payments/moneyfusion/simulate', (req, res) => {
  const { orderId, status, amount } = req.body;
  if (!orderId || !status) {
    return res.status(400).json({ error: "orderId and status are required." });
  }

  const isSuccess = (status === 'SUCCESS');
  const paymentStatus = isSuccess ? 'Payé' : 'Échoué';
  const orderStatus = isSuccess ? 'En cours de préparation' : 'Reçue';
  const paymentId = 'MF-' + Math.random().toString(36).substring(2, 10).toUpperCase();

  // Update order in database (like a webhook would do)
  db.run(`UPDATE orders SET payment_status = ?, status = ?, payment_id = ? WHERE id = ?`,
    [paymentStatus, orderStatus, paymentId, orderId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: "Erreur de base de données." });
      }

      // Simulate Triggering the webhook notification
      console.log(`[MONEYFUSION WEBHOOK LOG] Order ${orderId} updated to ${paymentStatus}. Transaction: ${paymentId}`);

      // Simulate WhatsApp / Email notifications on successful payment
      if (isSuccess) {
        db.get("SELECT * FROM orders WHERE id = ?", [orderId], (err, order) => {
          if (!err && order) {
            console.log(`[NOTIFICATION OUTBOX - PAID EMAIL] To: ${order.email}, dah1bossou@gmail.com`);
            console.log(`Subject: Paiement Confirmé - Commande #${orderId} - Mystique Shop`);
            console.log(`Body: Bonjour ${order.customer_name}, votre paiement de ${amount} FCFA via MoneyFusion a été confirmé ! Votre commande de la Bague Mystique de Richesse est désormais en cours de préparation.`);

            console.log(`[NOTIFICATION OUTBOX - PAID WHATSAPP] To: ${order.whatsapp}, +229 64 04 44 23`);
            console.log(`Message: Paiement de ${amount} FCFA reçu pour la commande #${orderId}. Statut de la bague : En cours de préparation.`);
          }
        });
      }

      res.json({ success: true, paymentId });
    }
  );
});

// Formal Webhook listener for external notifications
app.post('/api/payments/moneyfusion/webhook', (req, res) => {
  const { transactionId, orderId, status, amount } = req.body;
  if (!orderId || !status) {
    return res.status(400).json({ error: "Incomplet" });
  }

  const isSuccess = (status === 'SUCCESS' || status === 'SUCCESSFUL' || status === 'COMPLETED');
  const paymentStatus = isSuccess ? 'Payé' : 'Échoué';
  const orderStatus = isSuccess ? 'En cours de préparation' : 'Reçue';

  db.run(`UPDATE orders SET payment_status = ?, status = ?, payment_id = ? WHERE id = ?`,
    [paymentStatus, orderStatus, transactionId || ("MF-WH-" + Date.now()), orderId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: "Erreur interne" });
      }
      res.json({ received: true });
    }
  );
});

// -------------------------------------------------------------
// ADMIN LOGIN ENDPOINTS
// -------------------------------------------------------------

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Veuillez saisir votre identifiant et mot de passe." });
  }

  const hashed = hashPassword(password);
  db.get("SELECT id, username FROM users WHERE username = ? AND password = ?", [username, hashed], (err, row) => {
    if (err) {
      return res.status(500).json({ error: "Erreur serveur." });
    }
    if (!row) {
      return res.status(401).json({ error: "Identifiant ou mot de passe incorrect." });
    }

    req.session.isAdmin = true;
    req.session.username = row.username;
    res.json({ success: true, username: row.username });
  });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/admin/check', (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.json({ loggedIn: true, username: req.session.username });
  }
  res.json({ loggedIn: false });
});

// -------------------------------------------------------------
// PROTECTED ADMIN API ENDPOINTS
// -------------------------------------------------------------

// Dashboard Stats
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  // Get counts, sum of paid orders, etc.
  db.all("SELECT status, payment_status, total_price, quantity FROM orders", [], (err, orders) => {
    if (err) {
      return res.status(500).json({ error: "Erreur de statistiques." });
    }

    const totalOrders = orders.length;
    let totalRevenue = 0;
    let pendingOrders = 0;
    let paidOrders = 0;
    let ringsSold = 0;

    orders.forEach(o => {
      if (o.payment_status === 'Payé') {
        totalRevenue += o.total_price;
        paidOrders++;
        ringsSold += o.quantity;
      } else {
        pendingOrders++;
      }
    });

    db.all("SELECT * FROM testimonials", [], (err, testimonials) => {
      const totalTestimonials = testimonials ? testimonials.length : 0;
      const pendingTestimonials = testimonials ? testimonials.filter(t => t.status === 'pending').length : 0;

      res.json({
        totalOrders,
        totalRevenue,
        pendingOrders,
        paidOrders,
        ringsSold,
        totalTestimonials,
        pendingTestimonials
      });
    });
  });
});

// Manage Orders (Get All / Update)
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  db.all("SELECT * FROM orders ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: "Erreur" });
    res.json(rows);
  });
});

app.put('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const orderId = req.params.id;
  const { status, payment_status } = req.body;

  db.run("UPDATE orders SET status = ?, payment_status = ? WHERE id = ?", [status, payment_status, orderId], function(err) {
    if (err) return res.status(500).json({ error: "Erreur lors de la modification de la commande." });

    // Simulate Notification for Status update
    db.get("SELECT * FROM orders WHERE id = ?", [orderId], (err, order) => {
      if (!err && order) {
        console.log(`[STATUS UPDATE NOTIFICATION] Command #${orderId} set to Status: ${status}, Payment Status: ${payment_status}`);
        console.log(`[WHATSAPP] To: ${order.whatsapp} -> Le statut de votre commande #${orderId} a été mis à jour : ${status} (${payment_status}).`);
      }
    });

    res.json({ success: true });
  });
});

app.delete('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const orderId = req.params.id;
  db.run("DELETE FROM orders WHERE id = ?", [orderId], function(err) {
    if (err) return res.status(500).json({ error: "Erreur lors de la suppression." });
    res.json({ success: true });
  });
});

// Manage Product Details
app.get('/api/admin/product', requireAdmin, (req, res) => {
  db.get("SELECT * FROM products WHERE id = 1", [], (err, product) => {
    if (err) return res.status(500).json({ error: "Erreur" });
    res.json(product);
  });
});

app.put('/api/admin/product', requireAdmin, (req, res) => {
  const { title, description, price, promo_price, sizes, colors, images } = req.body;

  db.run(`UPDATE products SET title = ?, description = ?, price = ?, promo_price = ?, sizes = ?, colors = ?, images = ? WHERE id = 1`,
    [title, description, parseFloat(price), parseFloat(promo_price), sizes, colors, images],
    function(err) {
      if (err) return res.status(500).json({ error: "Erreur lors de la mise à jour du produit." });
      res.json({ success: true });
    }
  );
});

// Manage Testimonials (CRUD)
app.get('/api/admin/testimonials', requireAdmin, (req, res) => {
  db.all("SELECT * FROM testimonials ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: "Erreur" });
    res.json(rows);
  });
});

app.put('/api/admin/testimonials/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const { name, comment, rating, status } = req.body;
  db.run("UPDATE testimonials SET name = ?, comment = ?, rating = ?, status = ? WHERE id = ?",
    [name, comment, parseInt(rating), status, id],
    function(err) {
      if (err) return res.status(500).json({ error: "Erreur" });
      res.json({ success: true });
    }
  );
});

app.delete('/api/admin/testimonials/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  db.run("DELETE FROM testimonials WHERE id = ?", [id], function(err) {
    if (err) return res.status(500).json({ error: "Erreur" });
    res.json({ success: true });
  });
});

// Manage Promotions (CRUD)
app.get('/api/admin/promotions', requireAdmin, (req, res) => {
  db.all("SELECT * FROM promotions ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: "Erreur" });
    res.json(rows);
  });
});

app.post('/api/admin/promotions', requireAdmin, (req, res) => {
  const { code, discount_percent, active } = req.body;
  db.run("INSERT INTO promotions (code, discount_percent, active) VALUES (?, ?, ?)",
    [code.trim().toUpperCase(), parseInt(discount_percent), parseInt(active)],
    function(err) {
      if (err) return res.status(500).json({ error: "Ce code promo existe déjà ou est invalide." });
      res.json({ success: true, id: this.lastID });
    }
  );
});

app.put('/api/admin/promotions/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const { code, discount_percent, active } = req.body;
  db.run("UPDATE promotions SET code = ?, discount_percent = ?, active = ? WHERE id = ?",
    [code.trim().toUpperCase(), parseInt(discount_percent), parseInt(active), id],
    function(err) {
      if (err) return res.status(500).json({ error: "Erreur lors de la modification." });
      res.json({ success: true });
    }
  );
});

app.delete('/api/admin/promotions/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  db.run("DELETE FROM promotions WHERE id = ?", [id], function(err) {
    if (err) return res.status(500).json({ error: "Erreur" });
    res.json({ success: true });
  });
});

// Update Settings
app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const settingsData = req.body; // Key-value object
  const keys = Object.keys(settingsData);
  let errors = 0;

  db.serialize(() => {
    keys.forEach(k => {
      db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [k, String(settingsData[k])], (err) => {
        if (err) errors++;
      });
    });
  });

  setTimeout(() => {
    if (errors > 0) {
      return res.status(500).json({ error: "Certains paramètres n'ont pas pu être enregistrés." });
    }
    res.json({ success: true });
  }, 300);
});

// Start Express Server only if run directly (not required)
if (require.main === module) {
  initDb().then(() => {
    app.listen(PORT, () => {
      console.log(`[Mystique Shop Server] running on http://localhost:${PORT}`);
    });
  });
}

module.exports = app; // For automated testing
