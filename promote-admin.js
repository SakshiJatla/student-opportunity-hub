const Database = require("better-sqlite3");
const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/promote-admin.js your@email.com");
  process.exit(1);
}
const db = new Database("./data/opportunity-hub.db");
const user = db.prepare("SELECT id,email FROM users WHERE lower(email)=lower(?)").get(email);
if (!user) {
  console.error("User not found:", email);
  process.exit(1);
}
db.prepare("UPDATE users SET role='admin', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(user.id);
console.log(`Promoted ${user.email} to admin.`);
db.close();
