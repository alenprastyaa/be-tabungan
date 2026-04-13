// src/routes/index.js
const express = require("express");
const router = express.Router();

const auth = require("../controllers/authController");
const user = require("../controllers/userController");
const saving = require("../controllers/savingController");

const { verifyToken, isAdmin } = require("../middlewares/auth");
router.post("/login", auth.login);
router.post("/users", verifyToken, isAdmin, user.createUser);
router.get("/users/search", verifyToken, user.searchUser);
router.get('/users', verifyToken,isAdmin, user.getUserList);
router.put('/users/:id', verifyToken,isAdmin, user.updateUser); 
router.delete('/users/:id', verifyToken,isAdmin, user.deleteUser);

// saving
router.post("/deposit", verifyToken, isAdmin, saving.deposit);
router.post("/withdraw", verifyToken, isAdmin, saving.withdraw);
router.get("/user-history", verifyToken, saving.getHistory);
router.get("/balance", verifyToken, saving.getBalance);
router.get("/history", verifyToken, isAdmin, saving.getAllHistory);
router.get("/admin/balances", verifyToken, isAdmin, saving.getAllBalances);
router.get("/my-balance", verifyToken, saving.getMyBalance);

router.use('/dashboard', verifyToken, isAdmin, saving.getDashboardSummary);
router.use('/user/dashboard', verifyToken, saving.getUserDashboardSummary);


module.exports = router;