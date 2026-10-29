const modal=document.getElementById("modal"), modalContent=document.getElementById("modalContent");
function openAuth(mode="login"){
  modal.classList.remove("hidden");
  const isRegister=mode==="register";
  modalContent.innerHTML=`<form id="authForm" class="form auth-form" onsubmit="submitAuth(event)" novalidate>
    <div class="auth-head">
      <div class="auth-icon">N</div>
      <div><h2>${isRegister?"Create your OptiPath account":"Welcome back"}</h2><small>${isRegister?"Join OptiPath and manage your student opportunities.":"Sign in to continue to your portal."}</small></div>
    </div>
    <div class="auth-section">
      <label>Account Type<select id="accountRole" name="role" onchange="toggleRoleFields()" required>
        <option value="">Select account type</option><option value="student">Student</option><option value="college">College</option><option value="admin">Admin / Organization</option>
      </select></label>
    </div>
    ${isRegister?`
    <div id="studentFields" class="auth-section">
      <label>Full name<input name="name" autocomplete="name" placeholder="Enter your full name"></label>
      <label>College / University<select id="studentCollege" name="student_college_id"><option value="">Loading colleges…</option></select></label>
    </div>
    <div id="collegeFields" class="auth-section" style="display:none">
      <label>College / University<select id="collegeAccountSelect" name="college_id" onchange="toggleCollegeEntry()"><option value="">Loading colleges…</option></select></label>
      <label id="newCollegeLabel" style="display:none">College name<input id="collegeName" name="college_name" placeholder="Enter your college / university name"></label>
    </div>
    <div id="adminFields" class="auth-section" style="display:none">
      <label>Admin name<input id="adminName" name="admin_name" autocomplete="name" placeholder="Enter admin name"></label>
    </div>`:""}
    <div class="auth-section auth-credentials">
      <label>Email address<input id="authEmail" name="email" type="email" autocomplete="email" placeholder="Enter your email address"></label>
      <label>Password<input id="authPassword" name="password" type="password" autocomplete="${isRegister?"new-password":"current-password"}" placeholder="${isRegister?"Create a password (8+ characters)":"Enter your password"}" ${isRegister?'minlength="8"':''}></label>
    </div>
    <button type="submit" class="btn auth-submit">${isRegister?"Create Account":"Login"}</button>
    <button type="button" class="btn ghost auth-switch" onclick="openAuth('${isRegister?"login":"register"}')">${isRegister?"Already have an account? Login":"New to OptiPath? Create Account"}</button>
  </form>`;
  modal.dataset.mode=mode;
  if(isRegister) { toggleRoleFields(); loadCollegeOptions(); }
  setTimeout(()=>document.getElementById("authEmail")?.focus(),50);
}

function closeModal(){modal.classList.add("hidden")} modal.addEventListener("click",e=>{if(e.target===modal)closeModal()});
async function loadCollegeOptions(){
  const select=document.getElementById("studentCollege");
  const collegeAccount=document.getElementById("collegeAccountSelect");
  if(!select&&!collegeAccount)return;
  try{const r=await fetch("/api/public/colleges",{cache:"no-store"});const colleges=await r.json();
    const html='<option value="">Select your college / university</option>'+colleges.map(c=>`<option value="${c.id}" data-college-name="${esc(c.name)}">${esc(c.name)}${c.city?" — "+esc(c.city):""}</option>`).join("");
    if(select)select.innerHTML=html;
    if(collegeAccount){collegeAccount.innerHTML=html+'<option value="__new__">My college / university is not listed</option>'; toggleCollegeEntry();}
  }
  catch{if(select)select.innerHTML='<option value="">Unable to load colleges</option>';if(collegeAccount)collegeAccount.innerHTML='<option value="">Unable to load colleges</option>';}
}

async function submitAuth(e){
  e.preventDefault();
  const form=e.target;
  const mode=modal.dataset.mode;
  const role=String(form.querySelector('select[name="role"]')?.value||"").trim().toLowerCase();

  if(mode!=="register"){
    const email=String(form.querySelector("#authEmail")?.value||"").trim();
    const password=String(form.querySelector("#authPassword")?.value||"");
    if(!role)return alert("Please select an account type");
    if(!email)return alert("Please enter your email address");
    if(!password)return alert("Please enter your password");
    try{
      const r=await fetch("/api/auth/login",{
        method:"POST",
        headers:{"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify({email,password,role})
      });
      const d=await r.json().catch(()=>({}));
      if(!r.ok){
        localStorage.removeItem("soh_token");
        localStorage.removeItem("soh_user");
        return alert(d.error||"Invalid email or password");
      }
      if(!d.token||!d.user){
        return alert("Login succeeded but no session was returned. Please restart the server and try again.");
      }
      localStorage.setItem("soh_token",d.token);
      localStorage.setItem("soh_user",JSON.stringify(d.user));
      window.location.replace("/portal.html");
    }catch(err){
      console.error(err);
      alert("Unable to connect to OptiPath server. Make sure npm start is running on port 4000.");
    }
    return;
  }

  const email=String(form.querySelector("#authEmail")?.value||"").trim();
  const password=String(form.querySelector("#authPassword")?.value||"");
  const body={email,password,role};

  if(!role)return alert("Please select an account type");

  if(role==="student"){
    const name=String(document.querySelector('#studentFields input[name="name"]')?.value||"").trim();
    const collegeId=String(document.getElementById("studentCollege")?.value||"").trim();
    if(!name)return alert("Please enter your full name");
    if(!collegeId)return alert("Please select your college / university");
    body.name=name;
    body.college_id=Number(collegeId);
  }

  if(role==="college"){
    const select=document.getElementById("collegeAccountSelect");
    const collegeId=String(select?.value||"").trim();
    if(!collegeId)return alert("Please select your college / university");
    if(collegeId==="__new__"){
      const collegeName=String(document.getElementById("collegeName")?.value||"").trim();
      if(!collegeName)return alert("Please enter your college / university name");
      body.name=collegeName; body.college_name=collegeName;
    }else{
      const selected=select?.selectedOptions?.[0];
      const collegeName=String(selected?.dataset?.collegeName||selected?.textContent||"").replace(/\s+—.*$/,'').trim();
      if(!collegeName)return alert("Please select your college / university");
      body.name=collegeName; body.college_id=Number(collegeId); body.college_name=collegeName;
    }
  }

  if(role==="admin"){
    const name=String(document.getElementById("adminName")?.value||"").trim();
    if(!name)return alert("Please enter the admin / organization name");
    body.name=name;
  }

  console.log("OptiPath REGISTER PAYLOAD",body);

  try{
    const r=await fetch("/api/auth/register",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(body)
    });
    const d=await r.json().catch(()=>({}));
    console.log("OptiPath REGISTER RESPONSE",d);
    if(!r.ok)return alert(d.error||"Registration failed");

    // Registration never signs the user in. Open the login form with the new email pre-filled.
    localStorage.removeItem("soh_token");
    localStorage.removeItem("soh_user");
    alert("Account registered successfully. Please log in with your email and password.");
    openAuth("login");
    setTimeout(()=>{const input=document.getElementById("authEmail"); if(input){input.value=email; input.focus();}},50);
  }catch(err){
    console.error(err);
    alert("Unable to connect to OptiPath server. Make sure the backend is running on port 4000.");
  }
}
async function loadOpportunities(){const s=document.getElementById("oppSearch").value,c=document.getElementById("oppCategory").value;const r=await fetch("/api/opportunities?search="+encodeURIComponent(s)+"&category="+encodeURIComponent(c));const data=await r.json();document.getElementById("opportunities").innerHTML=data.length?data.map(o=>`<article class="card"><span class="eyebrow">${esc(o.category)}</span><h3>${esc(o.title)}</h3><p class="muted">${esc(o.organization)}</p><p>${esc((o.description||"").slice(0,150))}${o.description.length>150?"…":""}</p><div class="tags"><span class="tag">${esc(o.mode||"—")}</span><span class="tag">${esc(o.location||"Location not specified")}</span></div><div class="meta"><span>Deadline<br><b>${esc(o.deadline||"Not specified")}</b></span><span>Positions<br><b>${o.positions||"—"}</b></span></div><div class="footer"><button class="btn" onclick="openAuth()">View / Apply</button></div></article>`).join(""):`<div class="card"><h3>No opportunities available yet.</h3><p class="muted">New opportunities will appear here when an administrator publishes them.</p></div>`}
async function loadCourses(){const r=await fetch("/api/courses");const d=await r.json();document.getElementById("coursesGrid").innerHTML=d.length?d.map(c=>`<article class="card"><span class="eyebrow">${esc(c.category||"Credit Course")}</span><h3>${esc(c.name)}</h3><p class="muted">${esc(c.code)} · ${c.credits} credit(s)</p><p>${esc(c.description)}</p><div class="meta"><span>Instructor<br><b>${esc(c.instructor||"—")}</b></span><span>Duration<br><b>${esc(c.duration||"—")}</b></span></div><button class="btn" onclick="openAuth('login')">View Course</button></article>`).join(""):`<div class="card"><h3>No credit courses are currently available.</h3><p class="muted">Published courses will appear here.</p></div>`}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
loadOpportunities();loadCourses();
function toggleCollegeEntry(){
  const select=document.getElementById("collegeAccountSelect");
  const nameInput=document.getElementById("collegeName");
  const nameLabel=document.getElementById("newCollegeLabel");
  if(!select||!nameInput)return;
  const isNew=select.value==="__new__";
  if(nameLabel) nameLabel.style.display=isNew?"grid":"none";
  nameInput.style.display=isNew?"block":"none";
  nameInput.required=isNew;
  nameInput.disabled=!isNew;
}
function toggleRoleFields(){
  const role=document.getElementById("accountRole")?.value || "";
  const student=document.getElementById("studentFields");
  const college=document.getElementById("collegeFields");
  const admin=document.getElementById("adminFields");

  if(student){
    const nameInput=student.querySelector('input[name="name"]');
    const collegeSelect=document.getElementById("studentCollege");
    student.style.display=role==="student"?"block":"none";
    if(nameInput) nameInput.required=role==="student";
    if(collegeSelect) collegeSelect.required=role==="student";
    // Disabled controls are excluded from FormData and browser validation.
    if(nameInput) nameInput.disabled=role!=="student";
    if(collegeSelect) collegeSelect.disabled=role!=="student";
  }

  if(college){
    const select=document.getElementById("collegeAccountSelect");
    college.style.display=role==="college"?"block":"none";
    if(select) select.required=role==="college";
    if(select) select.disabled=role!=="college";
    if(role!=="college" && select) select.value="";
    toggleCollegeEntry();
  }

  if(admin){
    const nameInput=document.getElementById("adminName");
    admin.style.display=role==="admin"?"block":"none";
    if(nameInput) nameInput.required=role==="admin";
    if(nameInput) nameInput.disabled=role!=="admin";
  }

}
