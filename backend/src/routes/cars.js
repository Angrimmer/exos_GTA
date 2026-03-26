const express = require("express");
const router = express.Router();
const pool = require("../config/db");

// GET /cars -> liste toutes les voitures
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM cars");
    res.json(rows);
  } catch (error) {
    console.error("Erreur MySQL /cars :", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /cars -> ajoute une voiture
router.post("/", async (req, res) => {
  const {
    name,
    brand,
    type,
    max_speed,
    price,
    rarity,
    created_at
  } = req.body;

  if (!name || !brand) {
    return res.status(400).json({ message: "name et brand sont obligatoires" });
  }

  try {
    const sql = `
      INSERT INTO cars
        (name, brand, type, max_speed, price, rarity, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      name,
      brand,
      type || "Standard",
      max_speed ?? null,
      price ?? 0.0,
      rarity ?? null,
      created_at ?? null
    ];

    const [result] = await pool.query(sql, values);

    res.status(201).json({
      id: result.insertId,
      name,
      brand,
      type: type || "Standard",
      max_speed,
      price: price ?? 0.0,
      rarity,
      created_at
    });
  } catch (error) {
    console.error("Erreur MySQL POST /cars :", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// GET /cars/:id -> retourne une voiture par son id
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query("SELECT * FROM cars WHERE id = ?", [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: "Véhicule introuvable" });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error("Erreur MySQL GET /cars/:id :", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});


module.exports = router;
