const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const authenticateToken = require("../middlewares/auth");
const requireAdmin = require("../middlewares/requireAdmin");
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);


// POST /api/orders -> créer une commande
router.post("/", authenticateToken, async (req, res) => {
  const { items } = req.body;
  // items = [{ car_id: 1, quantity: 2 }, ...]

  if (!items || items.length === 0) {
    return res.status(400).json({ message: "Le panier est vide" });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Créer la commande
    const [orderResult] = await connection.query(
      "INSERT INTO orders (user_id, status) VALUES (?, 'pending')",
      [req.user.id]
    );
    const orderId = orderResult.insertId;

    // 2. Pour chaque item
    for (const item of items) {
      const { car_id, quantity } = item;

      // Vérifier le stock (FOR UPDATE = verrou pendant la transaction)
      const [shopRows] = await connection.query(
        "SELECT * FROM shop WHERE car_id = ? AND available = TRUE FOR UPDATE",
        [car_id]
      );

      if (shopRows.length === 0) {
        throw new Error(`Véhicule ${car_id} introuvable dans le shop`);
      }

      const shopItem = shopRows[0];

      if (shopItem.stock < quantity) {
        throw new Error(`Stock insuffisant pour le véhicule ${car_id}`);
      }

      // Décrémenter le stock
      await connection.query(
        "UPDATE shop SET stock = stock - ? WHERE car_id = ?",
        [quantity, car_id]
      );

      // Insérer la ligne de commande
      await connection.query(
        "INSERT INTO order_items (order_id, car_id, quantity, unit_price) VALUES (?, ?, ?, ?)",
        [orderId, car_id, quantity, shopItem.price]
      );

      // Ajouter au garage du user (une entrée par véhicule acheté)
      for (let i = 0; i < quantity; i++) {
        await connection.query(
          "INSERT INTO user_garage (user_id, car_id, order_id) VALUES (?, ?, ?)",
          [req.user.id, car_id, orderId]
        );
      }
    }

    // 3. Passer la commande en "paid"
    await connection.query(
      "UPDATE orders SET status = 'paid' WHERE id = ?",
      [orderId]
    );

    await connection.commit();

    res.status(201).json({
      message: "Commande validée",
      order_id: orderId
    });

  } catch (error) {
    await connection.rollback();
    console.error("Erreur POST /orders :", error.message);
    res.status(400).json({ message: error.message });
  } finally {
    connection.release();
  }
});

// GET /api/orders -> historique des commandes du user connecté
router.get("/", authenticateToken, async (req, res) => {
  try {
    const [orders] = await pool.query(
      "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC",
      [req.user.id]
    );
    res.json(orders);
  } catch (error) {
    console.error("Erreur GET /orders :", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/orders/:id -> détail d'une commande
router.get("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const [order] = await pool.query(
      "SELECT * FROM orders WHERE id = ? AND user_id = ?",
      [id, req.user.id]
    );

    if (order.length === 0) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    const [items] = await pool.query(`
      SELECT
        order_items.quantity,
        order_items.unit_price,
        vehicles.name,
        vehicles.brand,
        vehicles.rarity
      FROM order_items
      JOIN vehicles ON order_items.car_id = vehicles.id
      WHERE order_items.order_id = ?
    `, [id]);

    res.json({ ...order[0], items });
  } catch (error) {
    console.error("Erreur GET /orders/:id :", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/orders/all -> toutes les commandes (admin)
router.get("/all", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [orders] = await pool.query(`
      SELECT
        orders.id,
        orders.status,
        orders.created_at,
        users.username,
        COUNT(order_items.id) AS item_count
      FROM orders
      JOIN users       ON orders.user_id    = users.id
      LEFT JOIN order_items ON order_items.order_id = orders.id
      GROUP BY orders.id
      ORDER BY orders.created_at DESC
    `);
    res.json(orders);
  } catch (error) {
    console.error("Erreur GET /orders/all :", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/orders/checkout -> créer session Stripe
router.post("/checkout", authenticateToken, async (req, res) => {
  const { items } = req.body;

  try {
    const lineItems = await Promise.all(items.map(async (item) => {
      const [rows] = await pool.query(`
        SELECT shop.price, vehicles.name
        FROM shop
        JOIN vehicles ON shop.car_id = vehicles.id
        WHERE shop.car_id = ?
      `, [item.car_id]);

      if (!rows.length) throw new Error(`Véhicule ${item.car_id} introuvable`);

      return {
        price_data: {
          currency: 'usd',
          product_data: { name: rows[0].name },
          unit_amount: Math.round(parseFloat(rows[0].price) * 100),
        },
        quantity: item.quantity,
      };
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.FRONTEND_URL}/garage.html`,
      metadata: {
        user_id: String(req.user.id),
        items:   JSON.stringify(items)
      }
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("Erreur checkout :", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/orders/webhook -> Stripe confirme le paiement
router.post("/webhook", express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature invalide :", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const user_id = parseInt(session.metadata.user_id);
    const items   = JSON.parse(session.metadata.items);

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [orderResult] = await connection.query(
        "INSERT INTO orders (user_id, status) VALUES (?, 'paid')",
        [user_id]
      );
      const orderId = orderResult.insertId;

      for (const item of items) {
        const { car_id, quantity } = item;

        const [shopRows] = await connection.query(
          "SELECT * FROM shop WHERE car_id = ? FOR UPDATE", [car_id]
        );
        if (!shopRows.length || shopRows[0].stock < quantity) {
          throw new Error(`Stock insuffisant pour véhicule ${car_id}`);
        }

        await connection.query(
          "UPDATE shop SET stock = stock - ? WHERE car_id = ?", [quantity, car_id]
        );
        await connection.query(
          "INSERT INTO order_items (order_id, car_id, quantity, unit_price) VALUES (?, ?, ?, ?)",
          [orderId, car_id, quantity, shopRows[0].price]
        );

        for (let i = 0; i < quantity; i++) {
          await connection.query(
            "INSERT INTO user_garage (user_id, car_id, order_id) VALUES (?, ?, ?)",
            [user_id, car_id, orderId]
          );
        }
      }

      await connection.commit();
      console.log(`Commande #${orderId} traitée pour user ${user_id}`);
    } catch (err) {
      await connection.rollback();
      console.error("Erreur webhook :", err.message);
    } finally {
      connection.release();
    }
  }

  res.json({ received: true });
});


module.exports = router;
