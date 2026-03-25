const express = require("express");
const router = express.Router();
const pool = require("../config/db");

router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM cars");
    res.json(rows);
  } catch (error) {
    console.error("Erreur MySQL /cars :", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
