const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
let pdfParse = null;
try { pdfParse = require("pdf-parse"); } catch {}

const app = express();
const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || "student-opportunity-hub-local-secret";
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 10);
const APP_BASE_URL = String(process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/,"");

for (const d of ["data","uploads"]) fs.mkdirSync(path.join(__dirname,d), {recursive:true});

const db = new Database(path.join(__dirname,"data","opportunity-hub.db"));
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('student','college','admin')),
 college_id INTEGER,
 verified INTEGER NOT NULL DEFAULT 1,
 approval_status TEXT NOT NULL DEFAULT 'approved',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS student_profiles (
 user_id INTEGER PRIMARY KEY,
 phone TEXT, course TEXT, department TEXT, academic_year TEXT, semester TEXT,
 cgpa TEXT, skills TEXT, interests TEXT, career_goals TEXT, projects TEXT,
 certifications TEXT, achievements TEXT, linkedin TEXT, github TEXT, portfolio TEXT, profile_picture TEXT,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS colleges (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 code TEXT UNIQUE,
 city TEXT,
 state TEXT,
 description TEXT,
 logo_path TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS opportunities (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL, description TEXT NOT NULL, organization TEXT NOT NULL,
 category TEXT NOT NULL, opportunity_type TEXT NOT NULL, location TEXT,
 mode TEXT, start_date TEXT, end_date TEXT, deadline TEXT, eligibility TEXT,
 qualification TEXT, skills TEXT, positions INTEGER, stipend TEXT, salary TEXT,
 application_method TEXT, external_url TEXT, contact TEXT, attachment TEXT,
 status TEXT NOT NULL DEFAULT 'draft',
 created_by INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS saved_opportunities (
 user_id INTEGER NOT NULL, opportunity_id INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id,opportunity_id),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS applications (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 opportunity_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
 cover_note TEXT, resume_path TEXT,
 status TEXT NOT NULL DEFAULT 'Applied',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(opportunity_id,student_id),
 FOREIGN KEY(opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
 FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS attendance (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 student_id INTEGER NOT NULL, college_id INTEGER, activity TEXT NOT NULL,
 session TEXT, date TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('Present','Absent')),
 remarks TEXT, verification_status TEXT NOT NULL DEFAULT 'Pending',
 rejection_reason TEXT, created_by INTEGER NOT NULL, verified_by INTEGER,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, verified_at TEXT,
 FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(college_id) REFERENCES colleges(id),
 FOREIGN KEY(created_by) REFERENCES users(id),
 FOREIGN KEY(verified_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS courses (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, description TEXT NOT NULL,
 credits INTEGER NOT NULL DEFAULT 1, department TEXT, eligibility TEXT,
 duration TEXT, instructor TEXT, category TEXT, learning_objectives TEXT,
 syllabus TEXT, passing_percentage INTEGER DEFAULT 50,
 attendance_requirement INTEGER DEFAULT 75, certificate_eligible INTEGER DEFAULT 1,
 enrollment_limit INTEGER, status TEXT NOT NULL DEFAULT 'draft',
 created_by INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS course_enrollments (
 id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
 progress INTEGER NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0,
 score REAL, enrolled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT,
 UNIQUE(course_id,student_id),
 FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
 FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS attendance_summaries (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 student_id INTEGER NOT NULL, college_id INTEGER, degree TEXT NOT NULL,
 period_from TEXT NOT NULL, period_to TEXT NOT NULL, attended_lectures INTEGER NOT NULL DEFAULT 0,
 absent_lectures INTEGER NOT NULL DEFAULT 0, remarks TEXT, created_by INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(college_id) REFERENCES colleges(id),
 FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS certificates (
 id INTEGER PRIMARY KEY AUTOINCREMENT, certificate_id TEXT NOT NULL UNIQUE,
 student_id INTEGER NOT NULL, course_id INTEGER, title TEXT NOT NULL,
 issue_date TEXT NOT NULL, expiry_date TEXT, file_path TEXT,
 issuing_organization TEXT, status TEXT NOT NULL DEFAULT 'Valid',
 verification_note TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(course_id) REFERENCES courses(id)
);
CREATE TABLE IF NOT EXISTS notifications (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL,
 message TEXT NOT NULL, read_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL,
 entity TEXT, entity_id INTEGER, details TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_opp_status ON opportunities(status);
CREATE INDEX IF NOT EXISTS idx_apps_student ON applications(student_id);
CREATE INDEX IF NOT EXISTS idx_att_student ON attendance(student_id);
`);

try { db.exec("ALTER TABLE student_profiles ADD COLUMN resume_path TEXT"); } catch {}
try { db.exec("ALTER TABLE student_profiles ADD COLUMN profile_picture TEXT"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'"); } catch {}
try { db.exec("ALTER TABLE certificates ADD COLUMN institute_name TEXT"); } catch {}
try { db.exec("ALTER TABLE certificates ADD COLUMN degree TEXT"); } catch {}
try { db.exec("ALTER TABLE certificates ADD COLUMN period_from TEXT"); } catch {}
try { db.exec("ALTER TABLE certificates ADD COLUMN period_to TEXT"); } catch {}
try { db.exec("ALTER TABLE certificates ADD COLUMN publish_date TEXT"); } catch {}
try { db.exec("ALTER TABLE certificates ADD COLUMN signatory TEXT"); } catch {}
try { db.exec("ALTER TABLE colleges ADD COLUMN logo_path TEXT"); } catch {}

const defaultCollege=one("SELECT id FROM colleges WHERE lower(name)=lower(?)",["OptiPath University"]);
if(!defaultCollege) run("INSERT INTO colleges(name,code,city,state,description) VALUES(?,?,?,?,?)",["OptiPath University","OptiPath","Mumbai","Maharashtra","Primary university for OptiPath"]);

// Seed a broad Mumbai University college directory on first run. The names are drawn from the University of Mumbai affiliated-college listings;
// institutions already present are never duplicated.
const muColleges=[
"A. E. Kalsekar Degree College of Arts, Commerce and Science","A. P. Shah Institute of Technology","A. P. College of Arts, Commerce and Science","Aavishkar College of Arts, Commerce and Science","Abhinav College of Arts, Commerce and Science","Acharya College of Arts, Commerce and Science","Acharya Narendra Dev College of Arts, Commerce and Science","Adarsh College of Arts and Commerce","Aldel Education Trust's St. John College","Anna Leela College of Commerce and Economics","Anjuman-I-Islam's Allana Institute of Management Studies","Anjuman-I-Islam's College of Arts and Science","Anjuman-I-Islam's Kalsekar Technical Campus","Bhavan's College, Andheri","Bhavan's College, Chowpatty","B. L. Amlani College of Commerce and Economics","B. K. Birla College of Arts, Science and Commerce","B. N. Bandodkar College of Science, Thane","Bharat College of Arts and Commerce","Bhagwati College of Arts and Commerce","Birla College of Arts, Science and Commerce","Bombay College of Pharmacy","C. K. T. College of Management Studies","C. K. T. College of Arts, Commerce and Science","Chandrabhan Sharma College of Arts, Commerce and Science","Changu Kana Thakur Arts, Commerce and Science College","Chetana's Hazarimal Somani College of Commerce and Economics","CHM College","D. G. Ruparel College of Arts, Science and Commerce","D. M. Harish School of Law","D. G. Khetan International School and College","Dahanukar College of Commerce","D. J. Sanghvi College of Engineering","Dnyan Ganga Education Trust's College","Dnyanasadhana College","Durgadevi Saraf Institute of Management Studies","Elphinstone College","Fr. Conceicao Rodrigues College of Engineering","Fr. Agnel College of Arts and Commerce","Fr. Agnel College of Engineering","Ghanshyamdas Saraf College of Arts and Commerce","Guru Nanak Khalsa College of Arts, Science and Commerce","H. R. College of Commerce and Economics","Hafiz Mohammed Zubair College of Arts and Commerce","Hindustan College of Arts and Commerce","Hinduja College of Commerce","ICLES' Motilal Jhunjhunwala College of Arts, Science and Commerce","Indian Education Society's College of Arts, Science and Commerce","Institute of Forensic Science Mumbai","Jai Hind College","J. B. Vachha High School and Junior College","J. D. Birla Institute","Jai Bharat College of Commerce","J. K. College of Science and Commerce","K. C. College of Arts, Science and Commerce","K. C. Law College","K. E. S. Shroff College of Arts and Commerce","K. G. Mittal College of Arts and Commerce","K. J. Somaiya College of Arts and Commerce","K. J. Somaiya College of Science and Commerce","K. J. Somaiya College of Engineering","K. P. B. Hinduja College of Commerce","K. P. B. Hinduja College of Science","K. P. College of Arts, Commerce and Science","K. R. C. College of Management Studies","Kishinchand Chellaram College","K. V. Pendharkar College of Arts, Science and Commerce","Kelkar Education Trust's Vinayak Ganesh Vaze College","Kirti M. Doongursee College of Arts, Science and Commerce","Lala Lajpatrai College of Commerce and Economics","L. S. Raheja College of Arts and Commerce","M. L. Dahanukar College of Commerce","M. D. College of Arts, Science and Commerce","M. D. Shah Mahila College of Arts and Commerce","Mithibai College of Arts, Chauhan Institute of Science and Amrutben Jivanlal College of Commerce and Economics","M. M. K. College of Commerce and Economics","M. S. College of Arts, Science and Commerce","M. S. Ramaiah College of Arts and Commerce","M. V. Mandali's College of Commerce and Science","Malini Kishor Sanghvi College of Commerce and Economics","M. L. Dahanukar College of Commerce","Model College of Arts, Science and Commerce","M. P. Bhutta College of Science","Mulund College of Commerce","Nagindas Khandwala College","N. G. Acharya and D. K. Marathe College of Arts, Science and Commerce","N. K. College of Commerce and Economics","Nirmala Memorial Foundation College of Commerce and Science","Patkar-Varde College","Pillai College of Arts, Commerce and Science","Prahladrai Dalmia Lions College of Commerce and Economics","Ramnarain Ruia Autonomous College","R. A. Podar College of Commerce and Economics","R. D. National College","R. D. National College of Home Science","Rizvi College of Arts, Science and Commerce","Rizvi Law College","S. K. Somaiya College of Arts, Science and Commerce","Sathaye College","SIES College of Arts, Science and Commerce","SIES College of Commerce and Economics","SIES College of Management Studies","Siddharth College of Arts, Science and Commerce","Siddharth College of Commerce and Economics","Sir Sitaram and Lady Shantabai Patkar College of Arts and Science","Smt. Chandibai Himathmal Mansukhani College","Smt. K. G. Mittal College of Arts and Commerce","Sophia College for Women","St. Andrew's College of Arts, Science and Commerce","St. Xavier's College, Mumbai","Sydenham College of Commerce and Economics","Thakur College of Science and Commerce","Thakur College of Engineering and Technology","Thakur Institute of Management Studies, Career Development and Research","Tolani College of Commerce","University of Mumbai - Garware Institute of Career Education and Development","Usha Pravin Gandhi College of Arts, Science and Commerce","V. G. Vaze College of Arts, Science and Commerce","Vartak College of Arts, Science and Commerce","Vidyavardhini's College of Arts, Commerce and Science","Vivekanand Education Society's College of Arts, Science and Commerce","Vivekanand Education Society's Institute of Technology","Wilson College","Xavier Institute of Engineering","Yashwantrao Chavan College of Arts, Commerce and Science","Smt. P. N. Doshi Women's College","S. M. Shetty College of Science, Commerce and Management Studies","S. K. Somaiya College of Arts, Science and Commerce"
];
for(const name of [...new Set(muColleges)]){
  if(!one("SELECT id FROM colleges WHERE lower(name)=lower(?)",[name])) run("INSERT INTO colleges(name,code,city,state,description) VALUES(?,?,?,?,?)",[name,null,"Mumbai","Maharashtra","University of Mumbai affiliated-college directory entry"]);
}

function q(sql, params=[]) { return db.prepare(sql).all(...params); }
function one(sql, params=[]) { return db.prepare(sql).get(...params); }
function run(sql, params=[]) { return db.prepare(sql).run(...params); }
function audit(userId, action, entity, entityId, details="") {
  run("INSERT INTO audit_logs(user_id,action,entity,entity_id,details) VALUES(?,?,?,?,?)",[userId,action,entity,entityId,details]);
}
function notify(userId,title,message) { if(userId) run("INSERT INTO notifications(user_id,title,message) VALUES(?,?,?)",[userId,title,message]); }
function tokenFor(user) { return jwt.sign({id:user.id,role:user.role,email:user.email},JWT_SECRET,{expiresIn:"8h"}); }
function auth(req,res,next) {
  const h=req.headers.authorization||"";
  if(!h.startsWith("Bearer ")) return res.status(401).json({error:"Authentication required"});
  try {
    const claims=jwt.verify(h.slice(7),JWT_SECRET);
    // Always load the current user from SQLite. This prevents stale localStorage/JWT
    // data from breaking College/Admin portals after account repairs or updates.
    const u=one("SELECT id,name,email,role,college_id,approval_status FROM users WHERE id=?",[claims.id]);
    if(!u) return res.status(401).json({error:"User account no longer exists"});
    req.user=u;
    next();
  } catch { return res.status(401).json({error:"Invalid or expired session"}); }
}
function roles(...roles) { return (req,res,next)=> roles.includes(req.user.role) ? next() : res.status(403).json({error:"You do not have permission for this action"}); }
function today(){ return new Date().toISOString().slice(0,10); }

app.use(express.json({limit:"2mb"}));
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,"public")));

const storage = multer.diskStorage({
 destination: (_,__,cb)=>cb(null,path.join(__dirname,"uploads")),
 filename: (_,file,cb)=>cb(null,Date.now()+"-"+crypto.randomBytes(6).toString("hex")+"-"+file.originalname.replace(/[^a-zA-Z0-9._-]/g,"_"))
});
const upload = multer({
 storage,
 limits:{fileSize:MAX_FILE_MB*1024*1024},
 fileFilter:(_,file,cb)=>{
   const allowed=["application/pdf","image/png","image/jpeg","image/webp"];
   cb(null, allowed.includes(file.mimetype));
 }
});

app.get("/api/health",(req,res)=>res.json({status:"ok",service:"student-opportunity-hub",database:"sqlite"}));

app.get("/api/public/colleges",(req,res)=>res.json(q("SELECT id,name,code,city,state FROM colleges ORDER BY name")));

app.post("/api/auth/register",(req,res)=>{
  const input=req.body||{};
  const role=String(input.role||"student").trim().toLowerCase();
  const email=String(input.email||"").trim();
  const password=String(input.password||"");
  const name=String(input.name||input.full_name||(role==="college"?input.college_name:"")||"").trim();
  if(!name||!email||!password) return res.status(400).json({error:"Name, email and password are required"});
  if(password.length<8) return res.status(400).json({error:"Password must be at least 8 characters"});
  if(!["student","college","admin"].includes(role)) return res.status(400).json({error:"Choose student, college or admin"});
  try {
    const hash=bcrypt.hashSync(password,12);
    let collegeId=null;
    let approvalStatus="approved";
    let accountName=name;
    if(role==="college"){
      const requestedCollegeId=Number(input.college_id||0);
      const collegeName=String(input.college_name||name||"").trim();
      if(requestedCollegeId){
        const selected=one("SELECT id,name FROM colleges WHERE id=?",[requestedCollegeId]);
        if(!selected)return res.status(400).json({error:"Selected college / university does not exist"});
        collegeId=selected.id;
        // Always store the canonical institution name, never a stale form value.
        accountName=selected.name;
      } else {
        if(!collegeName)return res.status(400).json({error:"College / university is required"});
        const matches=q("SELECT id,name FROM colleges WHERE lower(trim(name))=lower(trim(?)) ORDER BY id",[collegeName]);
        if(matches.length){
          collegeId=matches[0].id;
          accountName=matches[0].name;
          if(matches.length>1){
            const ids=matches.slice(1).map(x=>x.id);
            const placeholders=ids.map(()=>"?").join(",");
            run(`UPDATE users SET college_id=? WHERE college_id IN (${placeholders})`,[collegeId,...ids]);
          }
        } else {
          collegeId=run("INSERT INTO colleges(name,code,city,state,description) VALUES(?,?,?,?,?)",[collegeName,null,"","","Created during college registration"]).lastInsertRowid;
          accountName=collegeName;
        }
      }
    }
    if(role==="student"){
      collegeId=Number(input.college_id||0);
      if(!collegeId || !one("SELECT id FROM colleges WHERE id=?",[collegeId])) return res.status(400).json({error:"Please select your college / university"});
      // Student accounts are immediately usable. College access status is managed
      // separately from authentication in the College Portal.
      approvalStatus="pending";
    }
    const info=run("INSERT INTO users(name,email,password_hash,role,college_id,verified,approval_status) VALUES(?,?,?,?,?,?,?)",[accountName.trim(),email.trim().toLowerCase(),hash,role,collegeId,role==="student"?0:1,approvalStatus]);
    const user=one("SELECT id,name,email,role,college_id,approval_status FROM users WHERE id=?",[info.lastInsertRowid]);
    if(role==="student") run("INSERT INTO student_profiles(user_id) VALUES(?)",[user.id]);
    audit(user.id,"REGISTER","user",user.id);
    // Students can log in immediately. Their college can later mark their
    // access as Agree, Pending, or Rejected from Manage Students Access.
    // Registration intentionally returns no authentication token.
    // The user must complete the separate Login step before entering a portal.
    res.status(201).json({user});
  } catch(e){ res.status(400).json({error:e.message.includes("UNIQUE")?"Email already registered":e.message}); }
});
app.post("/api/auth/login",(req,res)=>{
  const {email,password,role}=req.body||{};
  const selectedRole=String(role||"").trim().toLowerCase();
  if(!["student","college","admin"].includes(selectedRole)) return res.status(400).json({error:"Please select your account type"});
  const user=one("SELECT * FROM users WHERE lower(email)=lower(?)",[email||""]);
  if(!user||!bcrypt.compareSync(password||"",user.password_hash)) return res.status(401).json({error:"Invalid email or password"});
  if(user.role!==selectedRole) return res.status(403).json({error:"Selected account type does not match this account"});
  // Repair legacy college accounts created before college_id was linked correctly.
  // College staff must always be mapped to the same canonical college record used by students.
  if(user.role==="college") {
    // Prefer the institution name on the college account. This repairs both missing
    // and incorrectly linked legacy college accounts.
    let match=one("SELECT id,name FROM colleges WHERE lower(trim(name))=lower(trim(?)) ORDER BY id LIMIT 1",[user.name]);
    if(!match && user.college_id) match=one("SELECT id,name FROM colleges WHERE id=?",[user.college_id]);
    if(match){
      run("UPDATE users SET college_id=?,name=?,verified=1,approval_status='approved',updated_at=CURRENT_TIMESTAMP WHERE id=?",[match.id,match.name,user.id]);
      user.college_id=match.id;
      user.name=match.name;
    }
  }
  const safe={id:user.id,name:user.name,email:user.email,role:user.role,college_id:user.college_id,approval_status:user.approval_status,
    college_name:user.college_id?(one("SELECT name FROM colleges WHERE id=?",[user.college_id])?.name||null):null};
  audit(user.id,"LOGIN","user",user.id);
  res.json({user:safe,token:tokenFor(safe)});
});
app.get("/api/me",auth,(req,res)=>{
  const u=one(`SELECT u.id,u.name,u.email,u.role,u.college_id,u.approval_status,u.created_at,c.name AS college_name
    FROM users u LEFT JOIN colleges c ON c.id=u.college_id WHERE u.id=?`,[req.user.id]);
  if(!u) return res.status(404).json({error:"User not found"});
  const profile= u.role==="student" ? one("SELECT * FROM student_profiles WHERE user_id=?",[u.id]) : null;
  res.json({user:u,profile});
});

app.get("/api/opportunities",(req,res)=>{
  const search=(req.query.search||"").trim(); const cat=req.query.category||"";
  let sql="SELECT o.*, u.name AS creator_name FROM opportunities o JOIN users u ON u.id=o.created_by WHERE o.status='published'";
  const p=[];
  if(search){sql+=" AND (o.title LIKE ? OR o.organization LIKE ? OR o.skills LIKE ? OR o.description LIKE ?)"; const s="%"+search+"%";p.push(s,s,s,s);}
  if(cat){sql+=" AND o.category=?";p.push(cat);}
  sql+=" ORDER BY o.created_at DESC";
  res.json(q(sql,p));
});
app.get("/api/opportunities/:id",(req,res)=>{
  const o=one("SELECT * FROM opportunities WHERE id=?",[req.params.id]);
  if(!o || (o.status!=="published" && (!req.user || req.user.role!=="admin"))) return res.status(404).json({error:"Opportunity not found"});
  res.json(o);
});
app.get("/api/admin/opportunities",auth,roles("admin"),(req,res)=>res.json(q("SELECT * FROM opportunities ORDER BY created_at DESC")));
app.post("/api/admin/opportunities",auth,roles("admin"),(req,res)=>{
  const b=req.body;
  if(!b.title||!b.description||!b.organization||!b.category) return res.status(400).json({error:"Title, description, organization and category are required"});
  const info=run(`INSERT INTO opportunities(title,description,organization,category,opportunity_type,location,mode,start_date,end_date,deadline,eligibility,qualification,skills,positions,stipend,salary,application_method,external_url,contact,status,created_by)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  [b.title,b.description,b.organization,b.category,b.opportunity_type||b.category,b.location||"",b.mode||"Online",b.start_date||null,b.end_date||null,b.deadline||null,b.eligibility||"",b.qualification||"",b.skills||"",Number(b.positions)||0,b.stipend||"",b.salary||"",b.application_method||"Platform",null,b.contact||"",b.status==="published"?"published":"draft",req.user.id]);
  audit(req.user.id,"CREATE","opportunity",info.lastInsertRowid,b.title);
  res.json(one("SELECT * FROM opportunities WHERE id=?",[info.lastInsertRowid]));
});
app.put("/api/admin/opportunities/:id",auth,roles("admin"),(req,res)=>{
  const b=req.body; const old=one("SELECT * FROM opportunities WHERE id=?",[req.params.id]); if(!old)return res.status(404).json({error:"Not found"});
  const allowed=["title","description","organization","category","opportunity_type","location","mode","start_date","end_date","deadline","eligibility","qualification","skills","positions","stipend","salary","application_method","contact","status"];
  const vals=allowed.map(k=>b[k]!==undefined?b[k]:old[k]);
  run(`UPDATE opportunities SET ${allowed.map(k=>k+"=?").join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=?`,[...vals,req.params.id]);
  audit(req.user.id,"UPDATE","opportunity",Number(req.params.id));
  res.json(one("SELECT * FROM opportunities WHERE id=?",[req.params.id]));
});
app.delete("/api/admin/opportunities/:id",auth,roles("admin"),(req,res)=>{
  run("DELETE FROM opportunities WHERE id=?",[req.params.id]); audit(req.user.id,"DELETE","opportunity",Number(req.params.id)); res.json({ok:true});
});

app.post("/api/opportunities/:id/save",auth,roles("student"),(req,res)=>{
  const o=one("SELECT id FROM opportunities WHERE id=? AND status='published'",[req.params.id]); if(!o)return res.status(404).json({error:"Opportunity not found"});
  const exists=one("SELECT 1 FROM saved_opportunities WHERE user_id=? AND opportunity_id=?",[req.user.id,o.id]);
  if(exists){run("DELETE FROM saved_opportunities WHERE user_id=? AND opportunity_id=?",[req.user.id,o.id]);return res.json({saved:false});}
  run("INSERT INTO saved_opportunities(user_id,opportunity_id) VALUES(?,?)",[req.user.id,o.id]); res.json({saved:true});
});
app.get("/api/student/saved",auth,roles("student"),(req,res)=>res.json(q("SELECT o.* FROM saved_opportunities s JOIN opportunities o ON o.id=s.opportunity_id WHERE s.user_id=? ORDER BY s.created_at DESC",[req.user.id])));
app.post("/api/opportunities/:id/apply",auth,roles("student"),upload.single("resume"),(req,res)=>{
  const o=one("SELECT * FROM opportunities WHERE id=? AND status='published'",[req.params.id]); if(!o)return res.status(404).json({error:"Opportunity is unavailable"});
  if(o.deadline && o.deadline<today()) return res.status(400).json({error:"Application deadline has passed"});
  const exists=one("SELECT id FROM applications WHERE opportunity_id=? AND student_id=?",[o.id,req.user.id]);
  if(exists)return res.status(400).json({error:"You already applied to this opportunity"});
  const resume=req.file?req.file.filename:null;
  const info=run("INSERT INTO applications(opportunity_id,student_id,cover_note,resume_path) VALUES(?,?,?,?)",[o.id,req.user.id,req.body.cover_note||"",resume]);
  notify(req.user.id,"Application submitted",`Your application for ${o.title} was submitted to the recruitment team.`);
  q("SELECT id FROM users WHERE role='admin'").forEach(a=>notify(a.id,"New opportunity application",`${req.user.name||"A student"} applied for ${o.title}.`));
  audit(req.user.id,"APPLY","application",info.lastInsertRowid,o.title);
  res.json(one("SELECT * FROM applications WHERE id=?",[info.lastInsertRowid]));
});
app.get("/api/student/applications",auth,roles("student"),(req,res)=>res.json(q(`SELECT a.*,o.title,o.organization,o.deadline,o.category FROM applications a JOIN opportunities o ON o.id=a.opportunity_id WHERE a.student_id=? ORDER BY a.created_at DESC`,[req.user.id])));
app.get("/api/admin/applications",auth,roles("admin","college"),(req,res)=>{
  let sql=`SELECT a.*,o.title,o.organization,u.name AS student_name,u.email AS student_email FROM applications a JOIN opportunities o ON o.id=a.opportunity_id JOIN users u ON u.id=a.student_id`;
  const p=[]; if(req.user.role==="college"){sql+=" WHERE u.college_id=?";p.push(req.user.college_id||-1);} sql+=" ORDER BY a.created_at DESC"; res.json(q(sql,p));
});
app.patch("/api/applications/:id/status",auth,roles("admin","college"),(req,res)=>{
  const a=one("SELECT a.*,u.college_id,o.title FROM applications a JOIN users u ON u.id=a.student_id JOIN opportunities o ON o.id=a.opportunity_id WHERE a.id=?",[req.params.id]);
  if(!a)return res.status(404).json({error:"Application not found"});
  if(req.user.role==="college"&&a.college_id!==req.user.college_id)return res.status(403).json({error:"Unauthorized"});
  const allowed=["Applied","Under Review","Shortlisted","Interview","Selected","Rejected"];
  if(!allowed.includes(req.body.status))return res.status(400).json({error:"Invalid status"});
  run("UPDATE applications SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",[req.body.status,a.id]);
  notify(a.student_id,"Application status updated",`${a.title}: ${req.body.status}`);
  audit(req.user.id,"STATUS_UPDATE","application",a.id,req.body.status);
  res.json({ok:true});
});

app.get("/api/student/profile",auth,roles("student"),(req,res)=>res.json(one("SELECT u.id,u.name,u.email,u.college_id,u.approval_status,c.name AS college_name,p.* FROM users u LEFT JOIN colleges c ON c.id=u.college_id JOIN student_profiles p ON p.user_id=u.id WHERE u.id=?",[req.user.id])));
const profileUpload=multer({
  storage,
  limits:{fileSize:MAX_FILE_MB*1024*1024},
  fileFilter:(_,file,cb)=>{
    const allowed=["application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/msword","image/jpeg","image/png","image/webp"];
    cb(null,allowed.includes(file.mimetype));
  }
});
app.get("/api/student/profile",auth,roles("student"),(req,res)=>res.json(one("SELECT u.id,u.name,u.email,u.college_id,u.approval_status,c.name AS college_name,p.* FROM users u LEFT JOIN colleges c ON c.id=u.college_id JOIN student_profiles p ON p.user_id=u.id WHERE u.id=?",[req.user.id])));
app.put("/api/student/profile",auth,roles("student"),profileUpload.fields([{name:"resume",maxCount:1},{name:"profile_picture",maxCount:1}]),(req,res)=>{
  const b=req.body||{}, files=req.files||{};
  if(!String(b.name||"").trim()) return res.status(400).json({error:"Name is required"});
  const collegeId = b.college_id ? Number(b.college_id) : null;
  if (collegeId) { const c=one("SELECT id FROM colleges WHERE id=?",[collegeId]); if(!c) return res.status(400).json({error:"College not found"}); }
  run(`UPDATE users SET name=?,college_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,[String(b.name).trim(),collegeId,req.user.id]);
  const keys=["phone","course","department","academic_year","semester","skills"];
  const vals=[...keys.map(k=>b[k]||"")];
  if(files.resume?.[0]) { keys.push("resume_path"); vals.push(files.resume[0].filename); }
  if(files.profile_picture?.[0]) { keys.push("profile_picture"); vals.push(files.profile_picture[0].filename); }
  run(`UPDATE student_profiles SET ${keys.map(k=>k+"=?").join(",")} WHERE user_id=?`,[...vals,req.user.id]);
  res.json(one("SELECT u.id,u.name,u.email,u.college_id,u.approval_status,c.name AS college_name,p.* FROM users u LEFT JOIN colleges c ON c.id=u.college_id JOIN student_profiles p ON p.user_id=u.id WHERE u.id=?",[req.user.id]));
});

// All portal users can choose a college from the shared college directory in My Profile.
app.get("/api/profile/colleges",auth,(req,res)=>res.json(q("SELECT id,name,code,city,state FROM colleges ORDER BY name")));

// Every portal user can update their own account profile. Admins and colleges can
// edit their account name/email; college users can also maintain institution details.
app.get("/api/profile",auth,(req,res)=>{
  if(req.user.role==="student") return res.json(one("SELECT u.id,u.name,u.email,u.role,u.college_id,c.name AS college_name,p.* FROM users u LEFT JOIN colleges c ON c.id=u.college_id JOIN student_profiles p ON p.user_id=u.id WHERE u.id=?",[req.user.id]));
  const u=one("SELECT u.id,u.name,u.email,u.role,u.college_id,c.name AS college_name,c.code,c.city,c.state,c.description,c.logo_path FROM users u LEFT JOIN colleges c ON c.id=u.college_id WHERE u.id=?",[req.user.id]);
  res.json(u);
});
app.put("/api/profile",auth,upload.single("college_logo"),(req,res)=>{
  const b=req.body||{}, name=String(b.name||"").trim(), email=String(b.email||"").trim().toLowerCase();
  if(!name||!email) return res.status(400).json({error:"Name and email are required"});
  const duplicate=one("SELECT id FROM users WHERE lower(email)=lower(?) AND id<>?",[email,req.user.id]);
  if(duplicate) return res.status(400).json({error:"That email is already in use"});
  const collegeId = b.college_id ? Number(b.college_id) : null;
  if (collegeId) { const c=one("SELECT id FROM colleges WHERE id=?",[collegeId]); if(!c)return res.status(400).json({error:"College not found"}); }
  try { run("UPDATE users SET name=?,email=?,college_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",[name,email,collegeId,req.user.id]); }
  catch(e){ return res.status(400).json({error:e.message}); }
  if(req.user.role==="college" && collegeId){
    const existing=one("SELECT logo_path FROM colleges WHERE id=?",[collegeId]);
    const logo=req.file?.filename||existing?.logo_path||null;
    run("UPDATE colleges SET name=?,code=?,city=?,state=?,description=?,logo_path=? WHERE id=?",[String(b.college_name||b.name||"").trim()||name,b.code||null,b.city||"",b.state||"",b.description||"",logo,collegeId]);
  }
  const u=one("SELECT u.id,u.name,u.email,u.role,u.college_id,u.approval_status,c.name AS college_name,c.code,c.city,c.state,c.description,c.logo_path FROM users u LEFT JOIN colleges c ON c.id=u.college_id WHERE u.id=?",[req.user.id]);
  res.json(u);
});

app.get("/api/profile-picture/:id",auth,(req,res)=>{
  const target=one("SELECT u.id,u.role,u.college_id,p.profile_picture FROM users u LEFT JOIN student_profiles p ON p.user_id=u.id WHERE u.id=?",[req.params.id]);
  if(!target?.profile_picture) return res.status(404).end();
  if(req.user.role!=="admin" && Number(req.user.id)!==Number(target.id) && !(req.user.role==="college" && target.role==="student" && Number(target.college_id)===Number(req.user.college_id))) return res.status(403).json({error:"Unauthorized"});
  const file=path.join(__dirname,"uploads",target.profile_picture); if(!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

app.patch("/api/college/students/:id/access",auth,roles("college"),(req,res)=>{
  const student=one("SELECT id,name,email,college_id,role FROM users WHERE id=? AND role='student'",[req.params.id]);
  if(!student)return res.status(404).json({error:"Student not found"});
  if(Number(student.college_id)!==Number(req.user.college_id))return res.status(403).json({error:"Student belongs to another college"});
  const action=String(req.body.action||"pending").toLowerCase();
  const statusMap={agree:"approved",approved:"approved",pending:"pending",reject:"rejected",rejected:"rejected"};
  const status=statusMap[action];
  if(!status)return res.status(400).json({error:"Choose Agree, Pending, or Rejected"});
  // This status is administrative access tracking only. It never blocks student login.
  const verified=status==="approved"?1:0;
  run("UPDATE users SET verified=?,approval_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",[verified,status,student.id]);
  const title=status==="approved"?"College access marked Agree":status==="rejected"?"College access marked Rejected":"College access marked Pending";
  const message=status==="approved"?"Your college has marked your OptiPath access as Agree.":status==="rejected"?"Your college has marked your OptiPath access as Rejected. You can still use your OptiPath account; contact your college if you need clarification.":"Your college has marked your OptiPath access as Pending.";
  notify(student.id,title,message);
  audit(req.user.id,`ACCESS_${status.toUpperCase()}`,"student",student.id);
  res.json({ok:true,approval_status:status});
});
// Backward-compatible endpoint for older frontend builds.
app.patch("/api/college/students/:id/approve",auth,roles("college"),(req,res)=>{
  req.body={action:String(req.body.action||"pending").toLowerCase()==="approve"?"agree":String(req.body.action||"").toLowerCase()==="reject"?"reject":"pending"};
  return res.redirect(307,`/api/college/students/${req.params.id}/access`);
});

app.get("/api/college/student-requests",auth,roles("college"),(req,res)=>{
  // req.user is refreshed from the database by auth middleware, so this uses the
  // repaired college_id and returns every student assigned to that institution.
  const collegeId=Number(req.user.college_id||0);
  if(!collegeId) return res.status(400).json({error:"Your college account is not linked to a college. Please log out and log in again."});
  const d=q(`SELECT u.id,u.name,u.email,u.college_id,u.approval_status,u.verified,u.created_at,c.name college_name
    FROM users u LEFT JOIN colleges c ON c.id=u.college_id
    WHERE u.role='student' AND u.college_id=? ORDER BY CASE u.approval_status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,u.created_at DESC`,[collegeId]);
  res.json(d);
});

app.get("/api/admin/students",auth,roles("admin","college"),(req,res)=>{
  let sql=`SELECT u.id,u.name,u.email,u.college_id,u.approval_status,u.verified,u.created_at,c.name college_name FROM users u LEFT JOIN colleges c ON c.id=u.college_id WHERE u.role='student'`;const p=[];
  if(req.user.role==="college"){sql+=" AND u.college_id=?";p.push(req.user.college_id||-1);}
  res.json(q(sql,p));
});
app.patch("/api/admin/students/:id/college",auth,roles("admin"),(req,res)=>{
  const student=one("SELECT id,name,college_id FROM users WHERE id=? AND role='student'",[req.params.id]);
  if(!student) return res.status(404).json({error:"Student not found"});
  const collegeId=Number(req.body?.college_id||0);
  if(collegeId){ const c=one("SELECT id,name FROM colleges WHERE id=?",[collegeId]); if(!c)return res.status(400).json({error:"College not found"}); }
  run("UPDATE users SET college_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",[collegeId||null,student.id]);
  audit(req.user.id,"UPDATE","student_college",student.id,collegeId?String(collegeId):"unassigned");
  res.json(one("SELECT u.id,u.name,u.email,u.college_id,u.approval_status,u.verified,u.created_at,c.name college_name FROM users u LEFT JOIN colleges c ON c.id=u.college_id WHERE u.id=?",[student.id]));
});
app.get("/api/admin/colleges",auth,roles("admin"),(req,res)=>res.json(q("SELECT * FROM colleges ORDER BY name")));
app.post("/api/admin/colleges",auth,roles("admin"),upload.single("college_logo"),(req,res)=>{
  const b=req.body||{}; if(!b.name)return res.status(400).json({error:"College name required"});
  try{
    const logo=req.file?.filename||null;
    const i=run("INSERT INTO colleges(name,code,city,state,description,logo_path) VALUES(?,?,?,?,?,?)",[b.name,b.code||null,b.city||"",b.state||"",b.description||"",logo]);
    audit(req.user.id,"CREATE","college",i.lastInsertRowid);
    res.json(one("SELECT * FROM colleges WHERE id=?",[i.lastInsertRowid]));
  }catch(e){res.status(400).json({error:e.message})}
});

app.post("/api/college/attendance",auth,roles("college"),(req,res)=>{
  const b=req.body;if(!b.student_id||!b.activity||!b.date||!b.status)return res.status(400).json({error:"Student, activity, date and status are required"});
  const student=one("SELECT id,college_id FROM users WHERE id=? AND role='student'",[b.student_id]);if(!student)return res.status(404).json({error:"Student not found"});
  const i=run(`INSERT INTO attendance(student_id,college_id,activity,session,date,status,remarks,verification_status,created_by,verified_by,verified_at) VALUES(?,?,?,?,?,?,?,'Verified',?,?,CURRENT_TIMESTAMP)`,
  [student.id,student.college_id,b.activity,b.session||"",b.date,b.status,b.remarks||"",req.user.id,req.user.id]);
  const colleges=student.college_id?[student.college_id]:[];
  for(const c of colleges){const admins=q("SELECT id FROM users WHERE role='college' AND college_id=?",[c]);admins.forEach(x=>notify(x.id,"New attendance record","An official attendance record was added for a student in your college."));}
  audit(req.user.id,"CREATE","attendance",i.lastInsertRowid);res.json(one("SELECT * FROM attendance WHERE id=?",[i.lastInsertRowid]));
});
app.post("/api/college/attendance-summary",auth,roles("college"),(req,res)=>{
  const b=req.body;
  if(!b.student_id||!b.degree||!b.from_date||!b.to_date)return res.status(400).json({error:"Student, degree, from date and to date are required"});
  const attended=Math.max(0,Number(b.attended_lectures)||0), absent=Math.max(0,Number(b.absent_lectures)||0);
  const student=one("SELECT id,college_id FROM users WHERE id=? AND role='student'",[b.student_id]);
  if(!student)return res.status(404).json({error:"Student not found"});
  if(b.to_date<b.from_date)return res.status(400).json({error:"To date cannot be before From date"});
  const i=run(`INSERT INTO attendance_summaries(student_id,college_id,degree,period_from,period_to,attended_lectures,absent_lectures,remarks,created_by) VALUES(?,?,?,?,?,?,?,?,?)`,
    [student.id,student.college_id,b.degree,b.from_date,b.to_date,attended,absent,b.remarks||"",req.user.id]);
  notify(student.id,"Attendance updated",`Your attendance summary for ${b.degree} (${b.from_date} to ${b.to_date}) has been published.`);
  audit(req.user.id,"CREATE","attendance_summary",i.lastInsertRowid);
  res.json(one("SELECT * FROM attendance_summaries WHERE id=?",[i.lastInsertRowid]));
});

// Legacy attendance write endpoints are intentionally disabled. Attendance can only be updated by College accounts.
app.post("/api/admin/attendance",auth,roles("admin"),(req,res)=>res.status(403).json({error:"Only College accounts can update attendance."}));
app.post("/api/admin/attendance-summary",auth,roles("admin"),(req,res)=>res.status(403).json({error:"Only College accounts can update attendance."}));

app.get("/api/admin/attendance-summary",auth,roles("admin","college"),(req,res)=>{
  let sql=`SELECT a.*,u.name student_name,u.email student_email,c.name college_name FROM attendance_summaries a JOIN users u ON u.id=a.student_id LEFT JOIN colleges c ON c.id=a.college_id`;const p=[];
  if(req.user.role==="college"){sql+=" WHERE a.college_id=?";p.push(req.user.college_id||-1);}
  sql+=" ORDER BY a.created_at DESC";res.json(q(sql,p));
});
app.get("/api/student/attendance-summary",auth,roles("student"),(req,res)=>res.json(q(`SELECT a.*,c.name college_name FROM attendance_summaries a LEFT JOIN colleges c ON c.id=a.college_id WHERE a.student_id=? ORDER BY a.created_at DESC`,[req.user.id])));
app.get("/api/admin/attendance",auth,roles("admin","college"),(req,res)=>{
  let sql=`SELECT a.*,u.name student_name,u.email student_email,c.name college_name FROM attendance a JOIN users u ON u.id=a.student_id LEFT JOIN colleges c ON c.id=a.college_id`;const p=[];
  if(req.user.role==="college"){sql+=" WHERE a.college_id=?";p.push(req.user.college_id||-1);} sql+=" ORDER BY a.date DESC,a.id DESC";res.json(q(sql,p));
});
app.patch("/api/attendance/:id/verify",auth,roles("college"),(req,res)=>{
  const a=one("SELECT a.*,u.name student_name FROM attendance a JOIN users u ON u.id=a.student_id WHERE a.id=?",[req.params.id]);if(!a)return res.status(404).json({error:"Record not found"});
  if(a.college_id!==req.user.college_id)return res.status(403).json({error:"Unauthorized"});
  const action=req.body.action;if(!["verify","reject"].includes(action))return res.status(400).json({error:"Invalid action"});
  if(action==="reject"&&!req.body.reason)return res.status(400).json({error:"Rejection reason required"});
  run("UPDATE attendance SET verification_status=?,verified_by=?,verified_at=CURRENT_TIMESTAMP,rejection_reason=? WHERE id=?",[action==="verify"?"Verified":"Rejected",req.user.id,req.body.reason||null,a.id]);
  notify(a.created_by,`Attendance ${action==="verify"?"verified":"rejected"}`,`Attendance record #${a.id} for ${a.student_name} was ${action}ed.`);
  audit(req.user.id,action.toUpperCase(),"attendance",a.id,req.body.reason||"");res.json({ok:true});
});
app.get("/api/student/attendance",auth,roles("student"),(req,res)=>res.json(q("SELECT * FROM attendance WHERE student_id=? AND verification_status='Verified' ORDER BY date DESC",[req.user.id])));

app.post("/api/admin/courses",auth,roles("admin"),(req,res)=>{
  const b=req.body;if(!b.name||!b.code||!b.description)return res.status(400).json({error:"Name, code and description are required"});
  try{const i=run(`INSERT INTO courses(name,code,description,credits,department,eligibility,duration,instructor,category,learning_objectives,syllabus,passing_percentage,attendance_requirement,certificate_eligible,enrollment_limit,status,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  [b.name,b.code,b.description,Number(b.credits)||1,b.department||"",b.eligibility||"",b.duration||"",b.instructor||"",b.category||"",b.learning_objectives||"",b.syllabus||"",Number(b.passing_percentage)||50,Number(b.attendance_requirement)||75,b.certificate_eligible===false?0:1,Number(b.enrollment_limit)||null,b.status==="published"?"published":"draft",req.user.id]);
  audit(req.user.id,"CREATE","course",i.lastInsertRowid);res.json(one("SELECT * FROM courses WHERE id=?",[i.lastInsertRowid]));}catch(e){res.status(400).json({error:e.message})}
});
app.get("/api/courses",(req,res)=>res.json(q("SELECT * FROM courses WHERE status IN ('published','ongoing') ORDER BY created_at DESC")));
app.get("/api/admin/courses",auth,roles("admin"),(req,res)=>res.json(q("SELECT * FROM courses ORDER BY created_at DESC")));
app.post("/api/courses/:id/enroll",auth,roles("student"),(req,res)=>{
  const c=one("SELECT * FROM courses WHERE id=? AND status IN ('published','ongoing')",[req.params.id]);if(!c)return res.status(404).json({error:"Course not available"});
  const existing=one("SELECT id FROM course_enrollments WHERE course_id=? AND student_id=?",[c.id,req.user.id]);if(existing)return res.status(400).json({error:"Already enrolled"});
  if(c.enrollment_limit){const count=one("SELECT COUNT(*) n FROM course_enrollments WHERE course_id=?",[c.id]).n;if(count>=c.enrollment_limit)return res.status(400).json({error:"Enrollment limit reached"});}
  const i=run("INSERT INTO course_enrollments(course_id,student_id) VALUES(?,?)",[c.id,req.user.id]);notify(req.user.id,"Course enrollment successful",`You enrolled in ${c.name}.`);res.json(one("SELECT * FROM course_enrollments WHERE id=?",[i.lastInsertRowid]));
});
app.get("/api/student/courses",auth,roles("student"),(req,res)=>res.json(q(`SELECT e.*,c.name,c.code,c.credits,c.description,c.certificate_eligible FROM course_enrollments e JOIN courses c ON c.id=e.course_id WHERE e.student_id=? ORDER BY e.enrolled_at DESC`,[req.user.id])));
async function issueCourseCertificate(studentId, course){
  if(!course || !course.certificate_eligible) return null;
  const existing=one("SELECT * FROM certificates WHERE student_id=? AND course_id=? ORDER BY id DESC LIMIT 1",[studentId,course.id]);
  if(existing) return existing;
  const student=one("SELECT id,name FROM users WHERE id=? AND role='student'",[studentId]);
  if(!student) throw new Error("Student not found");
  const cid=newCertId(), issue=today(), filename=cid+".pdf", filePath=path.join(__dirname,"uploads",filename);
  const verifyUrl=`${APP_BASE_URL}/verify.html?id=${encodeURIComponent(cid)}`;
  const qr=await QRCode.toDataURL(verifyUrl);
  const doc=new PDFDocument({size:"A4",margin:60});
  const out=fs.createWriteStream(filePath);
  doc.pipe(out);
  doc.fontSize(28).text("OptiPath",{align:"center"}).moveDown();
  doc.fontSize(16).text("CERTIFICATE OF ACHIEVEMENT",{align:"center"}).moveDown(2);
  doc.fontSize(13).text("This certificate is proudly presented to",{align:"center"}).moveDown();
  doc.fontSize(25).text(student.name,{align:"center"}).moveDown();
  doc.fontSize(14).text(`for successfully completing ${course.name}`,{align:"center"}).moveDown();
  doc.fontSize(12).text(`Course Code: ${course.code}   •   Credits: ${course.credits}`,{align:"center"}).moveDown();
  doc.fontSize(12).text(`Certificate ID: ${cid}`,{align:"center"}).moveDown();
  doc.text(`Issue Date: ${issue}`,{align:"center"}).moveDown(2);
  doc.image(qr,430,650,{fit:[100,100]});
  doc.fontSize(10).text("Scan QR or use the Certificate ID to verify this certificate.",60,670,{width:300});
  doc.end();
  return await new Promise((resolve,reject)=>{
    out.on("finish",()=>{
      try{
        const i=run(`INSERT INTO certificates(certificate_id,student_id,course_id,title,issue_date,file_path,issuing_organization,status) VALUES(?,?,?,?,?,?,?,?)`,
          [cid,student.id,course.id,course.name,issue,filename,"OptiPath University"]);
        const cert=one("SELECT * FROM certificates WHERE id=?",[i.lastInsertRowid]);
        notify(student.id,"Credit course certificate issued",`Your certificate for ${course.name} is now available.`);
        resolve(cert);
      }catch(e){reject(e)}
    });
    out.on("error",reject);
  });
}

app.patch("/api/student/courses/:id/progress",auth,roles("student"),async(req,res)=>{
  try{
    const p=Math.max(0,Math.min(100,Number(req.body.progress)||0));const e=one("SELECT * FROM course_enrollments WHERE id=? AND student_id=?",[req.params.id,req.user.id]);if(!e)return res.status(404).json({error:"Enrollment not found"});
    const course=one("SELECT * FROM courses WHERE id=?",[e.course_id]);
    const completed=p>=100?1:0;run("UPDATE course_enrollments SET progress=?,completed=?,completed_at=? WHERE id=?",[p,completed,completed?new Date().toISOString():null,e.id]);
    const certificate=completed?await issueCourseCertificate(req.user.id,course):null;
    res.json({...one("SELECT * FROM course_enrollments WHERE id=?",[e.id]),certificate});
  }catch(err){res.status(500).json({error:err.message})}
});

function newCertId(){let id;do{id=`SOH-CERT-${new Date().getFullYear()}-${String(crypto.randomInt(1,999999)).padStart(6,"0")}`}while(one("SELECT id FROM certificates WHERE certificate_id=?",[id]));return id;}
app.get("/api/student/certificates",auth,roles("student"),(req,res)=>res.json(q(`SELECT c.*,co.name course_name FROM certificates c LEFT JOIN courses co ON co.id=c.course_id WHERE c.student_id=? AND c.status='Valid' ORDER BY c.issue_date DESC`,[req.user.id])));
app.get("/api/admin/certificates",auth,roles("admin","college"),(req,res)=>{
  let sql=`SELECT c.*,u.name student_name,u.email student_email,co.name course_name FROM certificates c JOIN users u ON u.id=c.student_id LEFT JOIN courses co ON co.id=c.course_id`;const p=[];
  if(req.user.role==="college"){sql+=" WHERE u.college_id=?";p.push(req.user.college_id||-1);}sql+=" ORDER BY c.issue_date DESC";res.json(q(sql,p));
});
app.post("/api/admin/certificates/generate",auth,roles("admin"),async(req,res)=>{
  const b=req.body||{};
  const student=one("SELECT * FROM users WHERE id=? AND role='student'",[b.student_id]);
  if(!student)return res.status(404).json({error:"Student not found"});
  const institute=one("SELECT * FROM colleges WHERE id=?",[b.institute_id]);
  if(!institute)return res.status(400).json({error:"Please select a college / university"});
  const course=b.course_id?one("SELECT * FROM courses WHERE id=?",[b.course_id]):null;
  if(course){const e=one("SELECT id FROM course_enrollments WHERE course_id=? AND student_id=? AND completed=1",[course.id,student.id]);if(!e)return res.status(400).json({error:"Student has not completed this course"});}
  const cid=newCertId();
  const issue=String(b.issue_date||today());
  const publish=String(b.publish_date||issue);
  const from=String(b.period_from||"");
  const to=String(b.period_to||"");
  const degree=String(b.degree||"Degree Programme");
  const signatory=String(b.signatory||"Authorized Signatory");
  const title=String(course?.name||b.title||"Certificate of Achievement");
  const filename=cid+".pdf";
  const filePath=path.join(__dirname,"uploads",filename);
  const verifyUrl=`${APP_BASE_URL}/verify.html?id=${encodeURIComponent(cid)}`;
  const qr=await QRCode.toDataURL(verifyUrl,{margin:1,width:180});
  const logoPath=institute.logo_path?path.join(__dirname,"uploads",path.basename(institute.logo_path)):path.join(__dirname,"public","optipath-logo.png");
  const doc=new PDFDocument({size:"A4",layout:"landscape",margin:0});
  const out=fs.createWriteStream(filePath); doc.pipe(out);
  const W=doc.page.width,H=doc.page.height;
  const green="#0F4D3B", gold="#C79A2B", dark="#17352E", muted="#587068";
  // Premium certificate background and double border
  doc.rect(0,0,W,H).fill("#FBFCFA");
  doc.save();
  doc.rect(24,24,W-48,H-48).lineWidth(2.2).stroke(gold);
  doc.rect(33,33,W-66,H-66).lineWidth(0.8).stroke(gold);
  doc.restore();
  // Corner ribbons
  doc.save(); doc.fillColor(green); doc.polygon([0,0,95,0,0,95]).fill(); doc.polygon([W,H,W-95,H,W,H-95]).fill();
  doc.fillColor(gold); doc.polygon([0,0,72,0,0,72]).fill(); doc.polygon([W,H,W-72,H,W,H-72]).fill(); doc.restore();
  // Subtle central watermark
  doc.save(); doc.opacity(0.035); doc.circle(W/2,H/2+10,145).fill(green); doc.restore();
  // Logo / institution header
  if(fs.existsSync(logoPath)) { try { doc.image(logoPath,68,58,{fit:[105,58],align:"left",valign:"center"}); } catch {} }
  doc.fillColor(green).font("Helvetica-Bold").fontSize(25).text(institute.name.toUpperCase(),190,63,{width:560,align:"left",characterSpacing:1.1});
  doc.fillColor(muted).font("Helvetica").fontSize(9.5).text("STUDENT OPPORTUNITY HUB • OFFICIAL CERTIFICATE",191,95,{width:520,characterSpacing:1.2});
  // Certificate ID + QR
  doc.fillColor(dark).font("Helvetica-Bold").fontSize(9).text(`Certificate No. ${cid}`,W-265,59,{width:190,align:"right"});
  doc.image(qr,W-150,82,{fit:[82,82]});
  doc.fillColor(muted).font("Helvetica").fontSize(7.5).text("SCAN TO VERIFY",W-150,167,{width:82,align:"center",characterSpacing:.8});
  // Main title
  doc.fillColor(gold).font("Helvetica-Bold").fontSize(11).text("CERTIFICATE OF ACHIEVEMENT",80,137,{width:W-160,align:"center",characterSpacing:2.8});
  doc.fillColor(dark).font("Helvetica").fontSize(11).text("THIS IS TO CERTIFY THAT",80,163,{width:W-160,align:"center",characterSpacing:2.4});
  doc.fillColor(green).font("Helvetica-BoldOblique").fontSize(31).text(student.name,80,188,{width:W-160,align:"center"});
  doc.moveTo(255,232).lineTo(W-255,232).lineWidth(1).stroke(gold);
  doc.fillColor(dark).font("Helvetica").fontSize(11.5).text("has successfully completed",80,248,{width:W-160,align:"center"});
  doc.fillColor(green).font("Helvetica-Bold").fontSize(17).text(title,{width:W-160,align:"center"});
  doc.fillColor(dark).font("Helvetica").fontSize(10.5).text(`Degree / Programme: ${degree}`,80,294,{width:W-160,align:"center"});
  // Information cards
  const infoY=325, cardW=185, gap=20, total=cardW*3+gap*2, x0=(W-total)/2;
  const cards=[['PROGRAMME PERIOD',from&&to?`${from}  —  ${to}`:'Not specified'],['DATE OF ISSUE',issue],['DATE OF PUBLISH',publish]];
  cards.forEach((it,i)=>{const x=x0+i*(cardW+gap);doc.roundedRect(x,infoY,cardW,52,6).lineWidth(.8).stroke("#D8E1DD");doc.fillColor(muted).font("Helvetica-Bold").fontSize(7.5).text(it[0],x+10,infoY+10,{width:cardW-20,align:"center",characterSpacing:1});doc.fillColor(dark).font("Helvetica-Bold").fontSize(9.5).text(it[1],x+8,infoY+28,{width:cardW-16,align:"center"});});
  // Signatures and digital validation
  const sigY=405;
  doc.fillColor(dark).font("Helvetica-Oblique").fontSize(19).text(signatory,88,sigY,{width:185,align:"center"});
  doc.moveTo(95,sigY+25).lineTo(270,sigY+25).lineWidth(.8).stroke(green);
  doc.fillColor(muted).font("Helvetica-Bold").fontSize(8).text("DIGITAL SIGNATURE",95,sigY+33,{width:175,align:"center",characterSpacing:1.1});
  doc.fillColor(muted).font("Helvetica").fontSize(7.5).text(signatory,{width:175,align:"center"});
  // Seal
  doc.save(); doc.circle(W/2,sigY+33,39).lineWidth(2).stroke(gold); doc.circle(W/2,sigY+33,31).lineWidth(1).stroke(gold); doc.fillColor(gold).font("Helvetica-Bold").fontSize(8).text("VERIFIED",W/2-28,sigY+29,{width:56,align:"center",characterSpacing:1}); doc.restore();
  doc.fillColor(dark).font("Helvetica-Bold").fontSize(10).text("Digitally signed and issued by the Administrator",W/2+95,sigY+8,{width:210,align:"center"});
  doc.fillColor(muted).font("Helvetica").fontSize(7.5).text(`Published on ${publish} • Verify online using Certificate No. ${cid}`,W/2+95,sigY+28,{width:210,align:"center"});
  // Footer
  doc.fillColor(green).font("Helvetica-Bold").fontSize(8).text("EXCELLENCE   •   INNOVATION   •   OPPORTUNITY",70,H-52,{width:W-140,align:"center",characterSpacing:1.2});
  doc.fillColor(muted).font("Helvetica").fontSize(7.5).text("This certificate is electronically generated and can be verified through the OptiPath verification portal.",70,H-38,{width:W-140,align:"center"});
  doc.end();
  out.on("finish",()=>{
    try{
      const i=run(`INSERT INTO certificates(certificate_id,student_id,course_id,title,issue_date,file_path,issuing_organization,status,institute_name,degree,period_from,period_to,publish_date,signatory) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [cid,student.id,course?.id||null,title,issue,filename,institute.name,"Valid",institute.name,degree,from,to,publish,signatory]);
      notify(student.id,"Certificate generated",`Your certificate for ${title} has been generated by the Administrator and is available to view.`);
      audit(req.user.id,"GENERATE","certificate",i.lastInsertRowid,cid);
      res.json(one("SELECT * FROM certificates WHERE id=?",[i.lastInsertRowid]));
    }catch(e){res.status(500).json({error:e.message})}
  });
});
app.post("/api/admin/certificates/upload",auth,roles("admin"),upload.single("certificate"),(req,res)=>{
  if(!req.file)return res.status(400).json({error:"Certificate file is required"});
  const b=req.body;const student=one("SELECT id FROM users WHERE id=? AND role='student'",[b.student_id]);if(!student)return res.status(404).json({error:"Student not found"});
  const cid=b.certificate_id||newCertId();
  try{const i=run(`INSERT INTO certificates(certificate_id,student_id,course_id,title,issue_date,expiry_date,file_path,issuing_organization,verification_note) VALUES(?,?,?,?,?,?,?,?,?)`,
  [cid,student.id,b.course_id||null,b.title||"Certificate",b.issue_date||today(),b.expiry_date||null,req.file.filename,b.issuing_organization||"",b.description||""]);
  notify(student.id,"Certificate uploaded",`A certificate (${cid}) was added to your account.`);audit(req.user.id,"UPLOAD","certificate",i.lastInsertRowid,cid);res.json(one("SELECT * FROM certificates WHERE id=?",[i.lastInsertRowid]));}catch(e){res.status(400).json({error:e.message})}
});
app.get("/api/certificates/view/:id",(req,res)=>{
  const c=one("SELECT certificate_id,file_path,status FROM certificates WHERE certificate_id=?",[req.params.id]);
  if(!c || c.status!=="Valid" || !c.file_path)return res.status(404).json({error:"Certificate not available"});
  const safeName=path.basename(c.file_path);
  const file=path.join(__dirname,"uploads",safeName);
  if(safeName!==c.file_path || !fs.existsSync(file))return res.status(404).json({error:"Certificate file not found"});
  res.setHeader("Content-Type","application/pdf");
  res.setHeader("Content-Disposition","inline; filename="+JSON.stringify(safeName));
  res.sendFile(file);
});
app.get("/api/certificates/verify/:id",(req,res)=>{
  const c=one(`SELECT c.certificate_id,c.title,c.issue_date,c.expiry_date,c.status,c.issuing_organization,c.institute_name,c.degree,c.period_from,c.period_to,c.publish_date,c.signatory,u.name student_name,co.name course_name
  FROM certificates c JOIN users u ON u.id=c.student_id LEFT JOIN courses co ON co.id=c.course_id WHERE c.certificate_id=?`,[req.params.id]);
  if(!c)return res.json({valid:false,status:"Invalid",message:"Certificate not found"});
  res.json({valid:c.status==="Valid",...c});
});
app.patch("/api/admin/certificates/:id/status",auth,roles("admin"),(req,res)=>{
  if(!["Valid","Revoked"].includes(req.body.status))return res.status(400).json({error:"Invalid status"});
  run("UPDATE certificates SET status=? WHERE id=?",[req.body.status,req.params.id]);audit(req.user.id,"CERTIFICATE_STATUS","certificate",Number(req.params.id),req.body.status);res.json({ok:true});
});
app.get("/api/files/:name",auth,(req,res)=>{
  const f=req.params.name;
  const cert=one("SELECT student_id FROM certificates WHERE file_path=?",[f]);
  const appn=one("SELECT student_id FROM applications WHERE resume_path=?",[f]);
  if(!cert&&!appn)return res.status(404).end();
  const ownerId=cert?.student_id||appn?.student_id;
  if(req.user.role!=="admin" && req.user.id!==ownerId){
    if(req.user.role!=="college")return res.status(403).json({error:"Unauthorized"});
    const owner=one("SELECT college_id FROM users WHERE id=? AND role='student'",[ownerId]);
    if(!owner || owner.college_id!==req.user.college_id)return res.status(403).json({error:"Unauthorized"});
  }
  const safeName=path.basename(f); const p=path.join(__dirname,"uploads",safeName);
  if(safeName!==f || !fs.existsSync(p))return res.status(404).end();
  res.sendFile(p);
});

app.get("/api/notifications",auth,(req,res)=>res.json(q("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50",[req.user.id])));
app.patch("/api/notifications/:id/read",auth,(req,res)=>{run("UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?",[req.params.id,req.user.id]);res.json({ok:true});});
function aiTextAnswer(message,user){
  const m=String(message||"").toLowerCase();
  const p=one("SELECT * FROM student_profiles WHERE user_id=?",[user.id])||{};
  const opp=one("SELECT COUNT(*) n FROM opportunities WHERE status='published'").n||0;
  const apps=one("SELECT COUNT(*) n FROM applications WHERE student_id=?",[user.id]).n||0;
  const resume=Boolean(p.resume_path);
  const skills=(p.skills||"").split(/[,\n]+/).map(x=>x.trim()).filter(Boolean);
  const name=p.name||user.name||"there";
  if(m.includes("hello")||m.includes("hi")||m.includes("hey")) return `Hi ${name}! I’m OptiPath AI, your career co-pilot. I can help you turn your profile into a stronger opportunity strategy. Try asking me about internships, your resume, skill gaps, attendance or what to do next.`;
  if(m.includes("resume")) return resume?`Your digital resume is already available. I recommend running Resume Analyzer next. It checks structure, relevant keywords, skills and improvement areas, then gives you an actionable readiness score.`:`Your first priority should be uploading a digital resume from My Profile. Once it is uploaded, Resume Analyzer can review its structure, keywords, skills and improvement areas.`;
  if(m.includes("skill")||m.includes("learn")) return skills.length?`You currently have ${skills.length} skill${skills.length===1?"":"s"} listed. Tell me a target role such as “Data Analyst” or “Full Stack Developer”, and Skill Gap Analyzer will compare your profile against the role and build a focused learning plan.`:`Your profile does not have enough listed skills yet. Start with a target role, then use Skill Gap Analyzer to identify the most important skills to build.`;
  if(m.includes("attendance")) return `For attendance, OptiPath uses your verified college records. Open Attendance Analyzer to see your percentage, risk level and a practical recovery recommendation. If your records are missing, ask your college to verify them.`;
  if(m.includes("internship")||m.includes("job")||m.includes("opportunit")||m.includes("apply")) return `There are currently ${opp} published opportunit${opp===1?"y":"ies"} on OptiPath. You have submitted ${apps} application${apps===1?"":"s"}. Open Explore Opportunities, filter for your target category, and prioritize roles where your current skills and resume are a strong match.`;
  if(m.includes("profile")||m.includes("career")||m.includes("next")) return `Here’s a strong next-step sequence for you: 1) complete your basic profile, 2) upload your resume, 3) run Resume Analyzer, 4) choose a target role and run Skill Gap Analyzer, and 5) apply to relevant opportunities. I can guide you through any step.`;
  if(m.includes("course")||m.includes("certificat")) return `Use Credit Courses to build verified learning progress and Certificates to track completed achievements. Choose courses that directly support the role you want rather than collecting unrelated certificates.`;
  return `I can help you with ${resume?"your resume, ":"your profile and resume, "}career planning, opportunities, skill development, attendance, courses and applications. Tell me your goal in one sentence and I’ll suggest the most useful next step.`;
}
app.post("/api/ai/chat",auth,(req,res)=>{
  const message=String(req.body.message||"").trim();
  if(!message)return res.status(400).json({error:"Message required"});
  res.json({reply:aiTextAnswer(message,req.user),mode:"OptiPath AI",engine:"OptiPath Career Intelligence"});
});
app.post("/api/ai/skill-gap",auth,roles("student"),(req,res)=>{
  const target=String(req.body.targetRole||"Software Developer").trim();
  const p=one("SELECT * FROM student_profiles WHERE user_id=?",[req.user.id])||{};
  const have=(p.skills||"").toLowerCase().split(/[,\n;|]+/).map(x=>x.trim()).filter(Boolean);
  const role=target.toLowerCase();
  const roleMaps=[
    [/data analyst|business analyst|data scientist|analytics/, ["Python","SQL","Statistics","Excel","Data Visualization","Power BI","Machine Learning"]],
    [/machine learning|ai engineer|artificial intelligence/, ["Python","Statistics","Machine Learning","Deep Learning","SQL","Git","Model Evaluation"]],
    [/full.?stack|web developer|frontend|front end/, ["HTML","CSS","JavaScript","React","REST APIs","Git","Responsive Design"]],
    [/backend|back end|software engineer|software developer|java developer|python developer/, ["Programming","Data Structures","Algorithms","SQL","REST APIs","Git","Problem Solving"]],
    [/mobile|android|ios|flutter|react native/, ["Programming","Mobile Development","APIs","Git","UI Design","Database","Testing"]],
    [/cloud|devops|site reliability|sre/, ["Linux","Cloud Computing","Docker","CI/CD","Git","Networking","Monitoring"]],
    [/cyber|security|ethical hacking|information security/, ["Networking","Linux","Cybersecurity","Security Tools","Python","Risk Management","Incident Response"]],
    [/ui.?ux|user experience|product designer|graphic designer/, ["Figma","UI Design","UX Research","Wireframing","Prototyping","Visual Design","Communication"]],
    [/digital marketing|marketing|seo|social media/, ["Communication","SEO","Analytics","Content Strategy","Social Media","Email Marketing","Digital Advertising"]],
    [/finance|financial analyst|accounting|banking/, ["Excel","Financial Analysis","Accounting","Data Analysis","Communication","Problem Solving","Attention to Detail"]],
    [/human resources|hr|recruiter|talent/, ["Communication","Recruitment","Interviewing","HR Management","Excel","Conflict Resolution","People Skills"]],
    [/sales|business development|business development executive/, ["Communication","Negotiation","Lead Generation","CRM","Presentation","Market Research","Relationship Management"]],
    [/project manager|product manager/, ["Project Management","Communication","Leadership","Agile","Problem Solving","Planning","Stakeholder Management"]],
    [/teacher|education|trainer|academic/, ["Communication","Teaching","Presentation","Lesson Planning","Assessment","Leadership","Digital Tools"]],
    [/content|copywriter|journalist|writer/, ["Writing","Communication","Research","Editing","Storytelling","SEO","Content Strategy"]],
    [/mechanical|civil|electrical|electronics|engineering/, ["Engineering Fundamentals","Problem Solving","Technical Drawing","CAD","Project Management","Communication","Safety"]],
    [/law|legal/, ["Legal Research","Communication","Drafting","Critical Thinking","Negotiation","Documentation","Attention to Detail"]]
  ];
  let map=null; for(const [pattern,skills] of roleMaps){if(pattern.test(role)){map=skills;break;}}
  if(!map){
    const roleWords=role.split(/[^a-z0-9]+/).filter(w=>w.length>2&&!['developer','engineer','analyst','manager','specialist','executive','professional','career'].includes(w));
    const generic=["Communication","Problem Solving","Critical Thinking","Digital Literacy","Teamwork","Project Management","Presentation"];
    map=[...new Set([...roleWords.slice(0,2).map(w=>w.charAt(0).toUpperCase()+w.slice(1)),...generic])];
  }
  const canonical=x=>{
    const a=String(x||"").toLowerCase().replace(/[^a-z0-9]+/g,"");
    const aliases={html5:"html",html:"html",css3:"css",css:"css",javascript:"javascript",js:"javascript",reactjs:"react",react:"react",restapi:"restapis",restapis:"restapis",api:"restapis",apis:"restapis",gitgithub:"git",github:"git",mysql:"sql",mssql:"sql",postgresql:"sql",postgres:"sql",plsql:"sql",pythonprogramming:"python",python:"python",machinelearning:"machinelearning",ml:"machinelearning",powerbi:"powerbi",excel:"excel",problemsolving:"problemsolving",responsivewebdesign:"responsivedesign",responsivedesign:"responsivedesign"};
    return aliases[a]||a;
  };
  const normalizedHave=have.flatMap(h=>h.split(/[/,+&]+/).map(canonical)).filter(Boolean);
  const missing=map.filter(x=>!normalizedHave.some(h=>{const a=canonical(h),b=canonical(x);return a===b||a.includes(b)||b.includes(a);}));
  const matched=map.filter(x=>!missing.includes(x));
  const score=map.length?Math.round(matched.length/map.length*100):0;
  const plan=missing.slice(0,5).map((x,i)=>({week:i+1,skill:x,action:`Build your ${x} capability through a focused course, one practical project and portfolio evidence.`}));
  if(!plan.length) plan.push({week:1,skill:"Practical Experience",action:`Strengthen your ${target} profile through projects, real-world practice, portfolio work and interview preparation.`});
  res.json({targetRole:target,currentSkills:have,matched,gaps:missing,score,plan});
});
app.get("/api/ai/college-insights",auth,roles("college","admin"),(req,res)=>{
  const cid=req.user.role==="college"?(req.user.college_id||-1):null;
  const where=cid!==null?" AND u.college_id=?":""; const params=cid!==null?[cid]:[];
  const students=one(`SELECT COUNT(*) n FROM users u WHERE u.role='student'${where}`,params).n;
  const applications=one(`SELECT COUNT(*) n FROM applications a JOIN users u ON u.id=a.student_id WHERE 1=1${where}`,params).n;
  const selected=one(`SELECT COUNT(*) n FROM applications a JOIN users u ON u.id=a.student_id WHERE a.status='Selected'${where}`,params).n;
  const verified=one(`SELECT COUNT(*) n FROM attendance a JOIN users u ON u.id=a.student_id WHERE a.verification_status='Verified'${where}`,params).n;
  const present=one(`SELECT COUNT(*) n FROM attendance a JOIN users u ON u.id=a.student_id WHERE a.verification_status='Verified' AND a.status='Present'${where}`,params).n;
  const attendance=verified?Math.round(present/verified*100):0;
  const placementRate=applications?Math.round(selected/applications*100):0;
  res.json({students,applications,selected,attendance,placementRate,insights:[students?`Your portal currently supports ${students} students.`:"No students are linked yet.",attendance?`Verified attendance health is ${attendance}%.`:"Attendance insights will appear after records are verified.",applications?`${selected} students have reached the Selected stage.`:"Application activity will appear as students apply."]});
});
app.post("/api/ai/attendance-analysis",auth,roles("student"),(req,res)=>{
  const summaries=q("SELECT a.*,c.name college_name FROM attendance_summaries a LEFT JOIN colleges c ON c.id=a.college_id WHERE a.student_id=? ORDER BY a.created_at DESC",[req.user.id]);
  if(summaries.length){
    const periods=summaries.map(x=>{const attended=Number(x.attended_lectures)||0,absent=Number(x.absent_lectures)||0,total=attended+absent,percent=total?Math.round(attended/total*100):0;return {degree:x.degree,period_from:x.period_from,period_to:x.period_to,attended,absent,total,percent,remarks:x.remarks||""};});
    const present=periods.reduce((n,x)=>n+x.attended,0),absent=periods.reduce((n,x)=>n+x.absent,0),total=present+absent,percent=total?Math.round(present/total*100):0;
    const risk=percent>=85?"Low":percent>=75?"Watch":"High";
    const insight=risk==='Low'?`Your published attendance is ${percent}%, which is in a healthy range. Continue attending sessions consistently.`:risk==='Watch'?`Your published attendance is ${percent}%. You are close to the minimum range, so regular attendance in upcoming sessions is important.`:`Your published attendance is ${percent}%. Attendance needs attention; focus on upcoming sessions and discuss justified absences with your college.`;
    return res.json({total,present,absent,percent,risk,periods,insight,source:"attendance_summaries"});
  }
  const rows=q("SELECT * FROM attendance WHERE student_id=? AND verification_status='Verified'",[req.user.id]);
  const total=rows.length,present=rows.filter(x=>x.status==="Present").length,percent=total?Math.round(present/total*100):0;
  const risk=percent>=85?"Low":percent>=75?"Watch":total?"High":"No data";
  res.json({total,present,absent:total-present,percent,risk,periods:[],insight:total?`Your verified lecture attendance is ${percent}%. ${risk==='Low'?"You are in a healthy range.":risk==='Watch'?"You are close to the minimum range; attend upcoming sessions consistently.":"Your attendance needs attention. Prioritize upcoming sessions and speak with your college if absences were justified."}`:"No attendance records are available yet. Once your college publishes an attendance summary, it will appear here automatically.",source:"attendance"});
});
app.post("/api/ai/resume-analysis",auth,roles("student"),async(req,res)=>{
  const p=one("SELECT * FROM student_profiles WHERE user_id=?",[req.user.id])||{};
  let text=[p.name,p.course,p.department,p.skills,p.interests,p.career_goals,p.projects,p.certifications,p.achievements].filter(Boolean).join(" ");
  if(p.resume_path && pdfParse){try{const buf=fs.readFileSync(path.join(__dirname,"uploads",p.resume_path));const parsed=await pdfParse(buf);text += " "+parsed.text;}catch{}}
  const lower=text.toLowerCase();
  const sections=["education","experience","skills","projects","certification","contact"].filter(x=>lower.includes(x));
  const keywords=["python","java","javascript","react","sql","excel","git","communication","leadership","machine learning","data analysis"].filter(x=>lower.includes(x));
  const missing=["experience","projects","skills","contact"].filter(x=>!sections.includes(x));
  const score=Math.min(100,40+sections.length*7+Math.min(25,keywords.length*4));
  res.json({score,detectedSections:sections,detectedSkills:keywords,suggestions:[...missing.map(x=>`Add a clear ${x} section.`),"Use measurable results in project or experience bullets.","Keep skills aligned with the roles you want."],summary:p.resume_path?"Resume uploaded and reviewed with OptiPath AI heuristics.":"No resume file uploaded; analysis is based on your profile details."});
});

app.get("/api/dashboard",auth,(req,res)=>{
  if(req.user.role==="student"){
    const opportunities=one("SELECT COUNT(*) n FROM opportunities WHERE status='published'").n;
    const applications=one("SELECT COUNT(*) n FROM applications WHERE student_id=?",[req.user.id]).n;
    const shortlisted=one("SELECT COUNT(*) n FROM applications WHERE student_id=? AND status IN ('Shortlisted','Interview','Selected')",[req.user.id]).n;
        const certs=one("SELECT COUNT(*) n FROM certificates WHERE student_id=? AND status='Valid'",[req.user.id]).n;
    const att=one("SELECT SUM(status='Present') present,COUNT(*) total FROM attendance WHERE student_id=? AND verification_status='Verified'",[req.user.id]);
    res.json({opportunities,applications,shortlisted,certificates:certs,attendance:att.total?Math.round(att.present/att.total*100):0});
  } else if(req.user.role==="admin"){
    res.json({
      students:one("SELECT COUNT(*) n FROM users WHERE role='student'").n,
      colleges:one("SELECT COUNT(*) n FROM colleges").n,
      opportunities:one("SELECT COUNT(*) n FROM opportunities").n,
      published:one("SELECT COUNT(*) n FROM opportunities WHERE status='published'").n,
      applications:one("SELECT COUNT(*) n FROM applications").n,
      certificates:one("SELECT COUNT(*) n FROM certificates").n,
      attendance:one("SELECT COUNT(*) n FROM attendance").n
    });
  } else {
    const cid=req.user.college_id||-1;
    const students=one("SELECT COUNT(*) n FROM users WHERE role='student' AND college_id=?",[cid]).n;
    const applications=one("SELECT COUNT(*) n FROM applications a JOIN users u ON u.id=a.student_id WHERE u.college_id=?",[cid]).n;
    const pendingAttendance=one("SELECT COUNT(*) n FROM attendance WHERE college_id=? AND verification_status='Pending'",[cid]).n;
    const verifiedAttendance=one("SELECT COUNT(*) n FROM attendance WHERE college_id=? AND verification_status='Verified'",[cid]).n;
    const selected=one("SELECT COUNT(*) n FROM applications a JOIN users u ON u.id=a.student_id WHERE u.college_id=? AND a.status='Selected'",[cid]).n;
    const avg=one("SELECT ROUND(AVG(CASE WHEN a.status='Present' THEN 100.0 ELSE 0 END),0) v FROM attendance a WHERE a.college_id=? AND a.verification_status='Verified'",[cid]).v||0;
    const college=one("SELECT id,name,code,city,state FROM colleges WHERE id=?",[cid]);
    const agreeStudents=one("SELECT COUNT(*) n FROM users WHERE role='student' AND college_id=? AND approval_status='approved'",[cid]).n;
    const pendingStudents=one("SELECT COUNT(*) n FROM users WHERE role='student' AND college_id=? AND approval_status='pending'",[cid]).n;
    const rejectedStudents=one("SELECT COUNT(*) n FROM users WHERE role='student' AND college_id=? AND approval_status='rejected'",[cid]).n;
    res.json({students,applications,pendingAttendance,verifiedAttendance,selected,attendanceHealth:avg,certificates:one("SELECT COUNT(*) n FROM certificates c JOIN users u ON u.id=c.student_id WHERE u.college_id=?",[cid]).n,agreeStudents,pendingStudents,rejectedStudents,college});
  }
});

app.get("/api/search",auth,(req,res)=>{
  const s="%"+(req.query.q||"").trim()+"%";
  if(s==="%%")return res.json({opportunities:[],courses:[],colleges:[]});
  res.json({
    opportunities:q("SELECT id,title,organization,category FROM opportunities WHERE status='published' AND (title LIKE ? OR organization LIKE ? OR skills LIKE ?) LIMIT 20",[s,s,s]),
    courses:q("SELECT id,name,code,category FROM courses WHERE status IN ('published','ongoing') AND (name LIKE ? OR code LIKE ? OR description LIKE ?) LIMIT 20",[s,s,s]),
    colleges:q("SELECT id,name,code,city,state FROM colleges WHERE name LIKE ? OR code LIKE ? LIMIT 20",[s,s])
  });
});

app.get(/.*/,(req,res)=>{
  if(req.path.startsWith("/api/")) return res.status(404).json({error:"API endpoint not found"});
  res.sendFile(path.join(__dirname,"public","index.html"));
});

app.listen(PORT,()=>console.log(`Student Opportunity Hub running at http://localhost:${PORT}`));
