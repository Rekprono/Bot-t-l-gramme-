const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

// Helper function to hash password securely using node:crypto
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function initDb() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // 1. Users table (Admin account)
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT
      )`, (err) => { if (err) console.error("Error creating users table", err); });

      // 2. Products table
      db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        description TEXT,
        price REAL,
        promo_price REAL,
        sizes TEXT,
        colors TEXT,
        images TEXT
      )`, (err) => { if (err) console.error("Error creating products table", err); });

      // 3. Orders table
      db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT,
        whatsapp TEXT,
        email TEXT,
        country TEXT,
        city TEXT,
        address TEXT,
        quantity INTEGER,
        color TEXT,
        size TEXT,
        comment TEXT,
        total_price REAL,
        promo_code TEXT,
        status TEXT,
        payment_status TEXT,
        payment_method TEXT,
        payment_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => { if (err) console.error("Error creating orders table", err); });

      // 4. Testimonials table
      db.run(`CREATE TABLE IF NOT EXISTS testimonials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        comment TEXT,
        rating INTEGER,
        avatar TEXT,
        status TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => { if (err) console.error("Error creating testimonials table", err); });

      // 5. Promotions table (Coupons)
      db.run(`CREATE TABLE IF NOT EXISTS promotions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE,
        discount_percent INTEGER,
        active INTEGER
      )`, (err) => { if (err) console.error("Error creating promotions table", err); });

      // 6. Settings table
      db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT UNIQUE,
        value TEXT
      )`, (err) => { if (err) console.error("Error creating settings table", err); });

      // Seed default admin user if not exists
      const defaultUsername = 'admin';
      const defaultPass = 'adminMystique2025!';
      const hashedPass = hashPassword(defaultPass);

      db.get("SELECT id FROM users WHERE username = ?", [defaultUsername], (err, row) => {
        if (!row) {
          db.run("INSERT INTO users (username, password) VALUES (?, ?)", [defaultUsername, hashedPass], (err) => {
            if (err) console.error("Failed to seed admin user", err);
            else console.log("Admin user seeded successfully with username: admin and password: adminMystique2025!");
          });
        }
      });

      // Seed default Product details
      db.get("SELECT id FROM products WHERE id = 1", [], (err, row) => {
        if (!row) {
          db.run(`INSERT INTO products (id, title, description, price, promo_price, sizes, colors, images)
            VALUES (1, ?, ?, ?, ?, ?, ?, ?)`, [
              "Bague Mystique de Richesse",
              "La légendaire Bague Mystique de Richesse est un talisman de haute tradition, conçue pour attirer les vibrations positives de prospérité, de succès et de protection spirituelle. Finement gravée de symboles sacrés et d'alignements géométriques ésotériques, elle est le symbole ultime d'élégance mystique et d'évolution personnelle.",
              250, // Original price (EUR or equivalent currency)
              149, // Promo price
              "54,56,58,60,62,64,66", // Sizes
              "Or,Noir,Argent", // Colors
              "/assets/images/bague_argent_1.jpg,/assets/images/bague_argent_2.jpg,/assets/images/bague_argent_3.jpg" // Images
            ], (err) => {
              if (err) console.error("Failed to seed product", err);
              else console.log("Default product seeded successfully!");
            });
        }
      });

      // Seed default promotions if none
      db.get("SELECT id FROM promotions WHERE code = 'MYSTIQUE15'", [], (err, row) => {
        if (!row) {
          db.run("INSERT INTO promotions (code, discount_percent, active) VALUES ('MYSTIQUE15', 15, 1)");
          db.run("INSERT INTO promotions (code, discount_percent, active) VALUES ('PROSPERITE20', 20, 1)");
        }
      });

      // Seed initial testimonials
      db.get("SELECT COUNT(id) AS count FROM testimonials", [], (err, row) => {
        if (row && row.count === 0) {
          const defaultTestimonials = [
            {
              name: "Amara Diallo",
              comment: "Depuis que je porte cette bague, je ressens une clarté d'esprit et une confiance incroyable. Mes affaires ont pris un élan inattendu ! Le design doré est d'une élégance rare.",
              rating: 5,
              avatar: "https://randomuser.me/api/portraits/men/32.jpg",
              status: "active"
            },
            {
              name: "Jean-Pierre Kouamé",
              comment: "Une merveille artistique. La livraison a été rapide partout en Côte d'Ivoire. Très satisfait de la qualité de la gravure et de la bague.",
              rating: 5,
              avatar: "https://randomuser.me/api/portraits/men/45.jpg",
              status: "active"
            },
            {
              name: "Sophie Mensah",
              comment: "C'est plus qu'un bijou. C'est un symbole quotidien de ma recherche d'évolution spirituelle et de prospérité. Je l'ai achetée en couleur argent, elle brille magnifiquement.",
              rating: 5,
              avatar: "https://randomuser.me/api/portraits/women/68.jpg",
              status: "active"
            }
          ];

          defaultTestimonials.forEach(t => {
            db.run(`INSERT INTO testimonials (name, comment, rating, avatar, status) VALUES (?, ?, ?, ?, ?)`,
              [t.name, t.comment, t.rating, t.avatar, t.status]);
          });
          console.log("Default testimonials seeded!");
        }
      });

      // Seed initial settings
      const defaultSettings = [
        { key: "site_name", value: "Mystique Shop" },
        { key: "contact_whatsapp", value: "+229 64 04 44 23" },
        { key: "contact_email", value: "dah1bossou@gmail.com" },
        { key: "currency", value: "FCFA" }, // e.g. FCFA or EUR or USD
        { key: "currency_symbol", value: "FCFA" },
        { key: "price_fcfa", value: "50000" }, // Product Price in FCFA
        { key: "promo_price_fcfa", value: "25000" }, // Product Promo Price in FCFA
        { key: "shipping_cost", value: "0" }, // Free Shipping
        { key: "moneyfusion_api_url", value: "https://api.moneyfusion.net/v1/payment" },
        { key: "moneyfusion_merchant_id", value: "MF-MYSTIQUE" },
        { key: "moneyfusion_api_key", value: "" } // Never store production keys/secrets in source code. Managed via environment variables or admin configuration.
      ];

      defaultSettings.forEach(s => {
        db.run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", [s.key, s.value]);
      });
      console.log("Default settings seeded!");

      // Final callback
      resolve();
    });
  });
}

module.exports = {
  db,
  initDb,
  hashPassword
};
