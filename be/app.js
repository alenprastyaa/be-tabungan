const express = require("express");
const cors = require("cors"); // import cors
const routes = require("./routes");
const { startReportScheduler } = require("./services/reportScheduler");

const app = express();

// aktifkan cors
app.use(cors());

app.use(express.json());
app.use("/api", routes);

app.listen(2100, () => {
  console.log("Server running on port 2100");
  startReportScheduler().catch((error) => {
    console.error("Failed to start report scheduler:", error);
  });
});
