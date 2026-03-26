const express = require("express");
const router  = express.Router();
const pool    = require("../config/db");
const authenticateToken = require("../middlewares/auth");

// GET /api/garage/:user_id -> véhicules possédés par un user
router.get("/:user_id", authenticateToken, async (req, res) => {
  const { user_id } = req.params;

  // Un user ne peut voir que son propre garage (sauf admin)
  if (req.user.id !== parseInt(user_id) && req.user.role !== 'admin') {
    return res.status(403).json({ message: "Accès refusé" });
  }

  try {
    const [rows] = await pool.query(`
      SELECT
        user_garage.id,
        user_garage.car_id,
        user_garage.acquired_at,
        user_garage.order_id,
        vehicles.name,
        vehicles.brand,
        vehicles.type,
        vehicles.category,
        vehicles.rarity,
        vehicles.max_speed,
        order_items.unit_price
      FROM user_garage
      JOIN vehicles   ON user_garage.car_id   = vehicles.id
      LEFT JOIN order_items
        ON order_items.order_id = user_garage.order_id
        AND order_items.car_id  = user_garage.car_id
      WHERE user_garage.user_id = ?
      ORDER BY user_garage.acquired_at DESC
    `, [user_id]);

    res.json(rows);
  } catch (error) {
    console.error("Erreur GET /garage/:user_id :", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
