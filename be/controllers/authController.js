const pool = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

exports.login = async (req, res) => {
  const { username, password } = req.body;
  const result = await pool.query(
    "SELECT * FROM users WHERE username = $1",
    [username]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ message: "User not found" });
  }
  const user = result.rows[0];
  const match = await bcrypt.compare(password, user.password);

  if (!match) {
    return res.status(400).json({ message: "Wrong password" });
  }
  const token = jwt.sign(
    { id: user.id, role: user.role },
    "SECRET",
    { expiresIn: "1d" }
  );

  res.json({
  id: user.id,
  username: user.username,
  full_name: user.full_name,
  role: user.role,
  dob: user.dob,
  token
});
};