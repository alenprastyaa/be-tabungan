const ExcelJS = require("exceljs");
const nodemailer = require("nodemailer");
const pool = require("../config/db");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const normalizeRecipients = (recipients) => {
  if (!Array.isArray(recipients)) return [];

  return [...new Set(
    recipients
      .map((email) => String(email || "").trim().toLowerCase())
      .filter(Boolean)
  )];
};

const normalizeScheduleTimes = (scheduleTimes) => {
  if (!Array.isArray(scheduleTimes)) return [];

  return [...new Set(
    scheduleTimes
      .map((time) => String(time || "").trim())
      .filter(Boolean)
  )].sort();
};

const validateSettings = (recipients, scheduleTimes) => {
  const invalidEmails = recipients.filter((email) => !EMAIL_REGEX.test(email));
  if (invalidEmails.length > 0) {
    return `Email tidak valid: ${invalidEmails.join(", ")}`;
  }

  const invalidTimes = scheduleTimes.filter((time) => !TIME_REGEX.test(time));
  if (invalidTimes.length > 0) {
    return `Jam kirim tidak valid: ${invalidTimes.join(", ")}. Gunakan format HH:mm`;
  }

  return null;
};

const ensureReportTables = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS report_email_settings (
      id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      recipients text[] NOT NULL DEFAULT '{}',
      schedule_times text[] NOT NULL DEFAULT '{}',
      enabled boolean NOT NULL DEFAULT false,
      updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    INSERT INTO report_email_settings (id, recipients, schedule_times, enabled)
    VALUES (1, '{}', '{}', false)
    ON CONFLICT (id) DO NOTHING
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS report_email_runs (
      id serial PRIMARY KEY,
      run_date date NOT NULL,
      scheduled_time varchar(5) NOT NULL,
      status varchar(20) NOT NULL,
      message text,
      sent_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (run_date, scheduled_time)
    )
  `);
};

const getReportSettings = async () => {
  await ensureReportTables();

  const result = await pool.query(`
    SELECT recipients, schedule_times, enabled, updated_at
    FROM report_email_settings
    WHERE id = 1
  `);

  return result.rows[0] || {
    recipients: [],
    schedule_times: [],
    enabled: false,
    updated_at: null
  };
};

const buildWorkbook = async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Tabungan Lebaran";
  workbook.created = new Date();

  const usersResult = await pool.query(`
    SELECT id, username, full_name, dob, address, phone, role, created_at
    FROM users
    ORDER BY id ASC
  `);

  const balancesResult = await pool.query(`
    SELECT
      u.id AS user_id,
      u.username,
      u.full_name,
      COALESCE(SUM(CASE WHEN s.type = 'deposit' THEN s.amount ELSE 0 END), 0) AS total_deposit,
      COALESCE(SUM(CASE WHEN s.type = 'withdraw' THEN s.amount ELSE 0 END), 0) AS total_withdraw,
      COALESCE(SUM(CASE WHEN s.type = 'withdraw' THEN s.penalty_amount ELSE 0 END), 0) AS total_penalty,
      COALESCE(SUM(CASE WHEN s.type = 'deposit' THEN s.amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN s.type = 'withdraw' THEN s.amount ELSE 0 END), 0) AS balance
    FROM users u
    LEFT JOIN savings s ON s.user_id = u.id
    WHERE u.role = 'user'
    GROUP BY u.id
    ORDER BY u.id ASC
  `);

  const transactionsResult = await pool.query(`
    SELECT
      s.id,
      s.user_id,
      u.username,
      u.full_name,
      s.type,
      s.amount,
      s.penalty_percent,
      s.penalty_amount,
      s.final_amount,
      s.created_by,
      admin.username AS created_by_username,
      s.created_at
    FROM savings s
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN users admin ON admin.id = s.created_by
    ORDER BY s.created_at DESC, s.id DESC
  `);

  const addSheet = (name, columns, rows) => {
    const sheet = workbook.addWorksheet(name);
    sheet.columns = columns;
    sheet.addRows(rows);
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.columns.forEach((column) => {
      column.width = Math.max(column.width || 12, 14);
    });
  };

  addSheet("Data Pelanggan", [
    { header: "ID", key: "id", width: 8 },
    { header: "Username", key: "username", width: 20 },
    { header: "Nama Lengkap", key: "full_name", width: 28 },
    { header: "Tanggal Lahir", key: "dob", width: 16 },
    { header: "Alamat", key: "address", width: 34 },
    { header: "Telepon", key: "phone", width: 18 },
    { header: "Role", key: "role", width: 12 },
    { header: "Dibuat", key: "created_at", width: 22 }
  ], usersResult.rows);

  addSheet("Tabungan", [
    { header: "User ID", key: "user_id", width: 10 },
    { header: "Username", key: "username", width: 20 },
    { header: "Nama Lengkap", key: "full_name", width: 28 },
    { header: "Total Setor", key: "total_deposit", width: 16 },
    { header: "Total Tarik", key: "total_withdraw", width: 16 },
    { header: "Total Penalti", key: "total_penalty", width: 16 },
    { header: "Saldo", key: "balance", width: 16 }
  ], balancesResult.rows);

  addSheet("Transaksi", [
    { header: "ID", key: "id", width: 8 },
    { header: "User ID", key: "user_id", width: 10 },
    { header: "Username", key: "username", width: 20 },
    { header: "Nama Lengkap", key: "full_name", width: 28 },
    { header: "Tipe", key: "type", width: 12 },
    { header: "Nominal", key: "amount", width: 16 },
    { header: "Persen Penalti", key: "penalty_percent", width: 16 },
    { header: "Nominal Penalti", key: "penalty_amount", width: 16 },
    { header: "Total Akhir", key: "final_amount", width: 16 },
    { header: "Dibuat Oleh", key: "created_by_username", width: 18 },
    { header: "Tanggal", key: "created_at", width: 22 }
  ], transactionsResult.rows);

  return workbook.xlsx.writeBuffer();
};

const getTransporter = () => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error("EMAIL_USER dan EMAIL_PASS belum dikonfigurasi di .env");
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
};

const sendReportEmail = async (recipients, scheduledTime = "manual") => {
  const normalizedRecipients = normalizeRecipients(recipients);

  if (normalizedRecipients.length === 0) {
    throw new Error("Minimal satu email penerima wajib diisi");
  }

  const invalidMessage = validateSettings(normalizedRecipients, scheduledTime === "manual" ? [] : [scheduledTime]);
  if (invalidMessage) {
    throw new Error(invalidMessage);
  }

  const buffer = await buildWorkbook();
  const now = new Date();
  const dateLabel = now.toISOString().slice(0, 10);
  const filename = `laporan-tabungan-${dateLabel}.xlsx`;
  const transporter = getTransporter();

  await transporter.sendMail({
    from: `"Tabungan Lebaran" <${process.env.EMAIL_USER}>`,
    to: normalizedRecipients.join(","),
    subject: `Backup Laporan Tabungan - ${dateLabel}`,
    text: "Terlampir laporan backup data pelanggan, tabungan, dan transaksi dalam format Excel.",
    attachments: [
      {
        filename,
        content: Buffer.from(buffer),
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      }
    ]
  });

  return { recipients: normalizedRecipients, filename };
};

exports.ensureReportTables = ensureReportTables;
exports.getReportSettingsData = getReportSettings;
exports.sendReportEmail = sendReportEmail;

exports.getSettings = async (req, res) => {
  try {
    const settings = await getReportSettings();
    res.json(settings);
  } catch (error) {
    console.error("Get report settings error:", error);
    res.status(500).json({ message: "Gagal mengambil setting laporan" });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const recipients = normalizeRecipients(req.body.recipients);
    const scheduleTimes = normalizeScheduleTimes(req.body.schedule_times);
    const enabled = Boolean(req.body.enabled);
    const invalidMessage = validateSettings(recipients, scheduleTimes);

    if (invalidMessage) {
      return res.status(400).json({ message: invalidMessage });
    }

    if (enabled && recipients.length === 0) {
      return res.status(400).json({ message: "Minimal satu email penerima wajib diisi jika jadwal aktif" });
    }

    if (enabled && scheduleTimes.length === 0) {
      return res.status(400).json({ message: "Minimal satu jam kirim wajib diisi jika jadwal aktif" });
    }

    await ensureReportTables();

    const result = await pool.query(`
      UPDATE report_email_settings
      SET recipients = $1, schedule_times = $2, enabled = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
      RETURNING recipients, schedule_times, enabled, updated_at
    `, [recipients, scheduleTimes, enabled]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Update report settings error:", error);
    res.status(500).json({ message: "Gagal menyimpan setting laporan" });
  }
};

exports.sendNow = async (req, res) => {
  try {
    const settings = await getReportSettings();
    const result = await sendReportEmail(settings.recipients, "manual");

    res.json({
      message: "Laporan berhasil dikirim",
      ...result
    });
  } catch (error) {
    console.error("Send report now error:", error);
    res.status(500).json({ message: error.message || "Gagal mengirim laporan" });
  }
};
