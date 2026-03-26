require("dotenv").config();
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;
const cors = require("cors")

const shopRouter = require("./src/routes/shop");
const carsRouter = require("./src/routes/cars");
const usersRouter = require("./src/routes/users");
const ordersRouter = require("./src/routes/orders");
const garageRouter = require("./src/routes/garage");

app.use('/api/orders/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(cors())

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Backend du garage gta fonctionne" });
});

app.use("/api/vehicles", carsRouter); 
app.use("/api/shop", shopRouter);
app.use("/api/users", usersRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/garage", garageRouter);


app.listen(PORT, () => {
  console.log(`API backend démarrée sur http://localhost:${PORT}`);
});
