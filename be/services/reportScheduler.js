const cron = require("node-cron");
const pool = require("../config/db");
const reportController = require("../controllers/reportController");

const TIMEZONE = "Asia/Jakarta";

let task = null;
let isRunning = false;

const getJakartaDateTime = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());

  const value = (type) => parts.find((part) => part.type === type)?.value;

  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`
  };
};

const markRun = async (date, time, status, message) => {
  await pool.query(`
    INSERT INTO report_email_runs (run_date, scheduled_time, status, message)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (run_date, scheduled_time)
    DO UPDATE SET status = EXCLUDED.status, message = EXCLUDED.message, sent_at = CURRENT_TIMESTAMP
  `, [date, time, status, message]);
};

const hasRun = async (date, time) => {
  const result = await pool.query(`
    SELECT id
    FROM report_email_runs
    WHERE run_date = $1 AND scheduled_time = $2 AND status = 'sent'
    LIMIT 1
  `, [date, time]);

  return result.rows.length > 0;
};

const runScheduledReport = async () => {
  if (isRunning) return;
  isRunning = true;

  try {
    const settings = await reportController.getReportSettingsData();

    if (!settings.enabled) return;

    const { date, time } = getJakartaDateTime();
    const scheduleTimes = settings.schedule_times || [];

    if (!scheduleTimes.includes(time)) return;
    if (await hasRun(date, time)) return;

    await reportController.sendReportEmail(settings.recipients || [], time);
    await markRun(date, time, "sent", "Laporan berhasil dikirim");
    console.log(`Report email sent for ${date} ${time}`);
  } catch (error) {
    const { date, time } = getJakartaDateTime();
    await markRun(date, time, "failed", error.message || "Gagal mengirim laporan");
    console.error("Scheduled report email failed:", error);
  } finally {
    isRunning = false;
  }
};

const startReportScheduler = async () => {
  await reportController.ensureReportTables();

  if (task) {
    task.stop();
  }

  task = cron.schedule("* * * * *", runScheduledReport, {
    timezone: TIMEZONE
  });

  console.log("Report email scheduler started");
};

module.exports = {
  startReportScheduler,
  runScheduledReport
};
