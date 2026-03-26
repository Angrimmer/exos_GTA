const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const authenticateToken = require("../middlewares/auth");
const requireAdmin      = require("../middlewares/requireAdmin");

// GET /api/shop -> liste tous les véhicules disponibles à la vente
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        shop.id        AS shop_id,
        shop.stock,
        shop.price     AS shop_price,
        shop.available,
        vehicles.id    AS car_id,
        vehicles.name,
        vehicles.brand,
        vehicles.type,
        vehicles.max_speed,
        vehicles.rarity
      FROM shop
      JOIN vehicles ON shop.car_id = vehicles.id
      WHERE shop.available = TRUE AND shop.stock > 0
      ORDER BY vehicles.name ASC
    `);
    res.json(rows);
  } catch (error) {
    console.error("Erreur MySQL GET /shop :", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/shop/:car_id -> détail d'un véhicule en vente
router.get("/:car_id", async (req, res) => {
  const { car_id } = req.params;
  try {
    const [rows] = await pool.query(`
      SELECT
        shop.id        AS shop_id,
        shop.stock,
        shop.price     AS shop_price,
        shop.available,
        vehicles.id    AS car_id,
        vehicles.name,
        vehicles.brand,
        vehicles.type,
        vehicles.max_speed,
        vehicles.rarity
      FROM shop
      JOIN vehicles ON shop.car_id = vehicles.id
      WHERE vehicles.id = ?
    `, [car_id]);

    if (rows.length === 0) {
      return res.status(404).json({ message: "Véhicule introuvable dans le shop" });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error("Erreur MySQL GET /shop/:car_id :", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PATCH /api/shop/:id/stock
router.patch("/:id/stock", authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { stock, available } = req.body;

  try {
    const fields = [];
    const values = [];

    if (stock !== undefined)     { fields.push("stock = ?");     values.push(stock); }
    if (available !== undefined) { fields.push("available = ?"); values.push(available); }

    if (fields.length === 0) {
      return res.status(400).json({ message: "Rien à mettre à jour" });
    }

    values.push(id);
    await pool.query(`UPDATE shop SET ${fields.join(", ")} WHERE id = ?`, values);
    res.json({ message: "Shop mis à jour" });
  } catch (error) {
    console.error("Erreur PATCH /shop/:id/stock :", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});


module.exports = router;
