const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const authenticateToken = require("../middlewares/auth");
const requireAdmin = require("../middlewares/requireAdmin");

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


module.exports = router;
