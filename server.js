/**
 * iAddress Pro v4.0 — FINAL PERFECT SERVER
 * Fix 1: New users get EMPTY contacts (no demo data)
 * Fix 2: Automatic birthday WhatsApp/SMS via Twilio (optional)
 *        OR browser notification trigger via API
 */

'use strict';

const express    = require('express');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const cors       = require('cors');
const Datastore  = require('nedb-promises');
const path       = require('path');
const fs         = require('fs');
const twilio = require('twilio');

const client = twilio(process.env.SID, process.env.TOKEN);
async function sendWhatsApp(phone, message) {
  try {
    await client.messages.create({
      from: 'whatsapp:+14155238886',
      to: `whatsapp:${phone}`,
      body: message
    });
    console.log('Message sent!');
  } catch (err) {
    console.error('WhatsApp Error:', err);
  }
}

const app  = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = 'iAddressPro_v4_SuperSecret_2024';

// ── DATABASE ──────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const usersDB    = Datastore.create({ filename: path.join(DATA_DIR, 'users.db'),    autoload: true });
const contactsDB = Datastore.create({ filename: path.join(DATA_DIR, 'contacts.db'), autoload: true });
const activityDB = Datastore.create({ filename: path.join(DATA_DIR, 'activity.db'), autoload: true });
const notifDB    = Datastore.create({ filename: path.join(DATA_DIR, 'notifs.db'),   autoload: true });

usersDB.ensureIndex({ fieldName: 'email', unique: true });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.path}`);
  next();
});

// ── AUTH MIDDLEWARE ───────────────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer '))
    return res.status(401).json({ error: 'Authentication required.' });
  try {
    req.user = jwt.verify(header.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired. Please login again.' });
  }
}

// ── CONSTANTS ─────────────────────────────────────────────
const COLORS = [
  '#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6',
  '#8b5cf6','#ef4444','#14b8a6','#f97316','#06b6d4',
  '#84cc16','#a855f7','#e11d48','#0891b2','#65a30d'
];

// ── LOG ACTIVITY ──────────────────────────────────────────
async function logActivity(userId, action, contactName) {
  try {
    await activityDB.insert({ userId, action, contactName, timestamp: new Date() });
    const all = await activityDB.find({ userId });
    if (all.length > 50) {
      const sorted = all.sort((a,b) => new Date(a.timestamp)-new Date(b.timestamp));
      await activityDB.remove({ _id: sorted[0]._id });
    }
  } catch(e) {}
}

// ── SMART AI (No API Key) ─────────────────────────────────
const AI_DB = {
  companies: {
    Work:     ['Tata Consultancy Services','Infosys Limited','Wipro Technologies','HCL Technologies','Tech Mahindra','Accenture India','IBM India','Cognizant','Capgemini India','Deloitte India'],
    Business: ['Reliance Industries','Adani Group','Mahindra Mahindra','Bajaj Auto','Godrej Industries','Tata Motors','Larsen Toubro','HDFC Bank','ICICI Bank','Axis Bank'],
    Friends:  ['Zomato India','Swiggy','Ola Cabs','Flipkart','Amazon India','Paytm','Nykaa','Urban Company','MakeMyTrip','BookMyShow'],
    College:  ['IIT Bombay','IIT Delhi','NIT Trichy','BITS Pilani','VIT Vellore','Manipal University','NMIMS Mumbai','Christ University','Anna University','Pune University'],
    Family:   ['Indian Railways','BSNL India','LIC India','ONGC','SAIL Steel','NTPC Limited','BHEL','HAL India','ISRO','DRDO India'],
    General:  ['Tata Consultancy Services','Infosys Limited','Wipro Technologies','Tech Mahindra','HCL Technologies'],
  },
  jobs: {
    Work:     ['Software Engineer','Senior Developer','Product Manager','Team Lead','Data Scientist','DevOps Engineer','UI UX Designer','Business Analyst','Project Manager','Scrum Master'],
    Business: ['Director','CEO','Business Development Manager','Sales Head','Marketing Manager','Finance Manager','Operations Head','Partner','Consultant','Entrepreneur'],
    Friends:  ['Graphic Designer','Content Creator','Photographer','Teacher','Freelancer','Blogger','Artist','Chef','Musician','YouTuber'],
    College:  ['Student','Research Scholar','Teaching Assistant','Professor','Lab Assistant','Project Intern','Campus Ambassador','PhD Scholar','Postdoc Researcher','Lecturer'],
    Family:   ['Engineer','Doctor','Government Officer','Bank Manager','Retired Professional','Home Maker','Farmer','Lawyer','Police Officer','Army Officer'],
    General:  ['Professional','Manager','Executive','Specialist','Consultant'],
  },
  cities: [
    'Mumbai, Maharashtra','Delhi, NCR','Bangalore, Karnataka','Chennai, Tamil Nadu',
    'Hyderabad, Telangana','Pune, Maharashtra','Kolkata, West Bengal','Ahmedabad, Gujarat',
    'Jaipur, Rajasthan','Surat, Gujarat','Lucknow, Uttar Pradesh','Kochi, Kerala',
    'Noida, Uttar Pradesh','Gurugram, Haryana','Chandigarh, Punjab',
  ],
  notes: {
    Work:     ['Excellent team player and collaborator','Expert in latest technologies','Led multiple successful projects','Known for problem-solving skills','Mentors junior developers'],
    Business: ['Strong network in the industry','Closed major deals last quarter','Strategic thinker with 10 years experience','Built company from scratch','Angel investor in startups'],
    Friends:  ['Met at college, very supportive friend','Travel buddy, loves adventures','Known since childhood','Met at a workshop last year','Introduced through mutual friends'],
    College:  ['Classmate from engineering batch','Lab partner and study group member','Top ranker of the batch','Active in college events','Research collaborator'],
    Family:   ['Uncle who helped during tough times','Close family friend for decades','Cousin who works in the city','Family doctor for 20 years','Childhood family friend'],
    General:  ['Professional contact','Met at industry conference','Referred by a colleague','Networking contact','Important business contact'],
  },
};

function smartAI(name, group) {
  const g    = AI_DB.companies[group] ? group : 'General';
  const idx  = (name || 'A').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const co   = AI_DB.companies[g][idx % AI_DB.companies[g].length];
  const job  = AI_DB.jobs[g][idx % AI_DB.jobs[g].length];
  const city = AI_DB.cities[idx % AI_DB.cities.length];
  const note = AI_DB.notes[g][idx % AI_DB.notes[g].length];
  const np   = (name||'contact').toLowerCase().replace(/[^a-z ]/g,'').trim().split(' ');
  const em   = np.join('.') + '@gmail.com';
  const pfx  = ['98','97','96','95','94','93','92','91','90','89'][idx%10];
  const num  = String(Math.abs(idx*7919)%100000000).padStart(8,'0');
  const ph   = `+91 ${pfx}${num.slice(0,3)} ${num.slice(3,8)}`;
  const tagMap = {
    Work:['tech','developer'],Business:['business','partner'],
    Friends:['friend','social'],College:['college','alumni'],
    Family:['family','relative'],General:['contact','professional']
  };
  return {
    company: co, jobTitle: job, email: em, phone: ph,
    address: city, group: g==='General'?'Work':g,
    notes: `${job} at ${co}. ${note}.`,
    website: '', tags: tagMap[g]||['contact','professional'],
  };
}

// ══════════════════════════════════════════════════════════
// AUTH ROUTES
// ══════════════════════════════════════════════════════════

// REGISTER — NEW USERS GET EMPTY CONTACTS
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'All fields are required.' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const hashed = bcrypt.hashSync(password, 10);
    const user   = await usersDB.insert({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashed,
      phone: '',
      createdAt: new Date()
    });
    const token = jwt.sign({ id: user._id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    // ✅ NO DEMO CONTACTS for new users — starts empty!
    console.log(`[REGISTER] New user: ${user.name} (${user.email}) — starting with 0 contacts`);

    res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch(e) {
    if (e.errorType === 'uniqueViolated') return res.status(409).json({ error: 'Email already registered.' });
    res.status(500).json({ error: 'Registration failed.' });
  }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
    const user = await usersDB.findOne({ email: email.toLowerCase().trim() });
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: 'Invalid email or password.' });
    const token = jwt.sign({ id: user._id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch(e) {
    res.status(500).json({ error: 'Login failed.' });
  }
});

app.get('/api/auth/me', auth, async (req, res) => {
  const user = await usersDB.findOne({ _id: req.user.id });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ id: user._id, name: user.name, email: user.email, phone: user.phone || '' });
});

app.put('/api/auth/profile', auth, async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required.' });
    await usersDB.update({ _id: req.user.id }, { $set: { name: name.trim(), phone: phone||'' } });
    res.json({ success: true, name: name.trim() });
  } catch { res.status(500).json({ error: 'Update failed.' }); }
});

app.put('/api/auth/password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required.' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Min 6 characters.' });
    const user = await usersDB.findOne({ _id: req.user.id });
    if (!bcrypt.compareSync(currentPassword, user.password)) return res.status(401).json({ error: 'Current password incorrect.' });
    await usersDB.update({ _id: req.user.id }, { $set: { password: bcrypt.hashSync(newPassword, 10) } });
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed.' }); }
});

// ══════════════════════════════════════════════════════════
// CONTACT ROUTES
// ══════════════════════════════════════════════════════════

app.get('/api/contacts', auth, async (req, res) => {
  try {
    const { search, favourite, group, sort='name', birthday_this_month } = req.query;
    let query = { userId: req.user.id };
    if (favourite === 'true') query.favourite = true;
    if (group) query.group = group;

    let list = await contactsDB.find(query);

    if (birthday_this_month === 'true') {
      const month = new Date().getMonth() + 1;
      list = list.filter(c => c.birthday && parseInt(c.birthday.split('-')[1]) === month);
    }

    if (search) {
      const s = search.toLowerCase();
      list = list.filter(c =>
        (c.name    ||'').toLowerCase().includes(s) ||
        (c.email   ||'').toLowerCase().includes(s) ||
        (c.phone   ||'').toLowerCase().includes(s) ||
        (c.company ||'').toLowerCase().includes(s) ||
        (c.address ||'').toLowerCase().includes(s) ||
        (c.notes   ||'').toLowerCase().includes(s) ||
        (c.tags    ||[]).some(t => t.toLowerCase().includes(s))
      );
    }

    list.sort((a,b) => {
      if (sort==='recent')    return new Date(b.createdAt)-new Date(a.createdAt);
      if (sort==='company')   return (a.company||'').localeCompare(b.company||'');
      if (sort==='favourite') return (b.favourite?1:0)-(a.favourite?1:0);
      return (a.name||'').localeCompare(b.name||'');
    });

    res.json(list);
  } catch(e) {
    console.error('[GET contacts]', e.message);
    res.status(500).json({ error: 'Failed to fetch contacts.' });
  }
});

app.get('/api/contacts/:id', auth, async (req, res) => {
  const c = await contactsDB.findOne({ _id: req.params.id, userId: req.user.id });
  if (!c) return res.status(404).json({ error: 'Not found.' });
  res.json(c);
});

app.post('/api/contacts', auth, async (req, res) => {
  try {
    const { name, email, email2, phone, phone2, address, company, notes, group, website, birthday, tags } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Contact name is required.' });
    const c = await contactsDB.insert({
      userId:      req.user.id,
      name:        name.trim(),
      email:       email   ||'',
      email2:      email2  ||'',
      phone:       phone   ||'',
      phone2:      phone2  ||'',
      address:     address ||'',
      company:     company ||'',
      notes:       notes   ||'',
      group:       group   ||'General',
      website:     website ||'',
      birthday:    birthday||'',
      tags:        Array.isArray(tags)?tags:[],
      favourite:   false,
      avatarColor: COLORS[Math.floor(Math.random()*COLORS.length)],
      createdAt:   new Date(),
      updatedAt:   new Date(),
    });
    await logActivity(req.user.id, 'added', name.trim());
    res.status(201).json(c);
  } catch(e) {
    console.error('[POST contact]', e.message);
    res.status(500).json({ error: 'Failed to add contact.' });
  }
});

app.put('/api/contacts/:id', auth, async (req, res) => {
  try {
    const c = await contactsDB.findOne({ _id: req.params.id, userId: req.user.id });
    if (!c) return res.status(404).json({ error: 'Not found.' });
    const { name, email, email2, phone, phone2, address, company, notes, group, website, birthday, tags } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required.' });
    await contactsDB.update({ _id: req.params.id }, {
      $set: {
        name:     name.trim(),
        email:    email    !==undefined ? email    : c.email,
        email2:   email2   !==undefined ? email2   : c.email2||'',
        phone:    phone    !==undefined ? phone    : c.phone,
        phone2:   phone2   !==undefined ? phone2   : c.phone2||'',
        address:  address  !==undefined ? address  : c.address,
        company:  company  !==undefined ? company  : c.company,
        notes:    notes    !==undefined ? notes    : c.notes,
        group:    group    !==undefined ? group    : c.group,
        website:  website  !==undefined ? website  : c.website,
        birthday: birthday !==undefined ? birthday : c.birthday,
        tags:     Array.isArray(tags)?tags:c.tags||[],
        updatedAt: new Date(),
      }
    });
    await logActivity(req.user.id, 'updated', name.trim());
    res.json(await contactsDB.findOne({ _id: req.params.id }));
  } catch(e) {
    console.error('[PUT contact]', e.message);
    res.status(500).json({ error: 'Failed to update.' });
  }
});

app.patch('/api/contacts/:id/favourite', auth, async (req, res) => {
  try {
    const c = await contactsDB.findOne({ _id: req.params.id, userId: req.user.id });
    if (!c) return res.status(404).json({ error: 'Not found.' });
    const newFav = !c.favourite;
    await contactsDB.update({ _id: req.params.id }, { $set: { favourite: newFav } });
    res.json({ favourite: newFav, id: req.params.id });
  } catch { res.status(500).json({ error: 'Failed.' }); }
});

app.delete('/api/contacts/:id', auth, async (req, res) => {
  try {
    const c = await contactsDB.findOne({ _id: req.params.id, userId: req.user.id });
    if (!c) return res.status(404).json({ error: 'Not found.' });
    await contactsDB.remove({ _id: req.params.id });
    await logActivity(req.user.id, 'deleted', c.name);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed.' }); }
});

app.delete('/api/contacts', auth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) return res.status(400).json({ error: 'No IDs.' });
    await contactsDB.remove({ _id: { $in: ids }, userId: req.user.id }, { multi: true });
    res.json({ success: true, deleted: ids.length });
  } catch { res.status(500).json({ error: 'Failed.' }); }
});

// ── STATS ─────────────────────────────────────────────────
app.get('/api/stats', auth, async (req, res) => {
  try {
    const all        = await contactsDB.find({ userId: req.user.id });
    const total      = all.length;
    const favourites = all.filter(c => c.favourite).length;
    const groups     = {};
    all.forEach(c => { const g=c.group||'General'; groups[g]=(groups[g]||0)+1; });

    const month = new Date().getMonth()+1;
    const birthdaysThisMonth = all
      .filter(c => c.birthday && parseInt(c.birthday.split('-')[1])===month)
      .map(c => ({ name:c.name, birthday:c.birthday, avatarColor:c.avatarColor }));

    const recent = [...all]
      .sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt))
      .slice(0,5)
      .map(c => ({ name:c.name, company:c.company, avatarColor:c.avatarColor, group:c.group }));

    const activity = (await activityDB.find({ userId: req.user.id }))
      .sort((a,b) => new Date(b.timestamp)-new Date(a.timestamp))
      .slice(0,10);

    res.json({
      total, favourites, groups,
      groupCount: Object.keys(groups).length,
      birthdaysThisMonth, recentlyAdded: recent, recentActivity: activity,
      withPhone:   all.filter(c=>c.phone).length,
      withEmail:   all.filter(c=>c.email).length,
      withCompany: all.filter(c=>c.company).length,
    });
  } catch(e) { res.status(500).json({ error: 'Failed.' }); }
});

app.get('/api/groups', auth, async (req, res) => {
  try {
    const all = await contactsDB.find({ userId: req.user.id });
    res.json([...new Set(all.map(c=>c.group||'General'))].sort());
  } catch { res.status(500).json({ error: 'Failed.' }); }
});

app.get('/api/tags', auth, async (req, res) => {
  try {
    const all = await contactsDB.find({ userId: req.user.id });
    res.json([...new Set(all.flatMap(c=>c.tags||[]))].sort());
  } catch { res.status(500).json({ error: 'Failed.' }); }
});

app.get('/api/activity', auth, async (req, res) => {
  try {
    const a = await activityDB.find({ userId: req.user.id });
    res.json(a.sort((a,b) => new Date(b.timestamp)-new Date(a.timestamp)).slice(0,20));
  } catch { res.status(500).json({ error: 'Failed.' }); }
});

// ── EXPORT / IMPORT ───────────────────────────────────────
app.get('/api/export/json', auth, async (req, res) => {
  try {
    const contacts = await contactsDB.find({ userId: req.user.id });
    const data = contacts.map(c => ({
      name:c.name, email:c.email, phone:c.phone, company:c.company,
      address:c.address, group:c.group, website:c.website,
      birthday:c.birthday, notes:c.notes, tags:c.tags, favourite:c.favourite,
    }));
    res.setHeader('Content-Disposition','attachment; filename="iaddress-contacts.json"');
    res.json(data);
  } catch { res.status(500).json({ error: 'Export failed.' }); }
});

app.get('/api/export/csv', auth, async (req, res) => {
  try {
    const contacts = await contactsDB.find({ userId: req.user.id });
    const headers  = ['Name','Email','Phone','Company','Address','Group','Website','Birthday','Notes','Favourite'];
    const rows     = contacts.map(c =>
      [c.name,c.email,c.phone,c.company,c.address,c.group,c.website,c.birthday,c.notes,c.favourite?'Yes':'No']
      .map(v=>`"${(v||'').toString().replace(/"/g,'""')}"`).join(',')
    );
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition','attachment; filename="iaddress-contacts.csv"');
    res.send([headers.join(','),...rows].join('\n'));
  } catch { res.status(500).json({ error: 'CSV export failed.' }); }
});

app.post('/api/import/json', auth, async (req, res) => {
  try {
    const { contacts } = req.body;
    if (!Array.isArray(contacts)||!contacts.length) return res.status(400).json({ error: 'No contacts.' });
    let imported = 0;
    for (const c of contacts) {
      if (!c.name?.trim()) continue;
      await contactsDB.insert({
        userId: req.user.id, name: c.name.trim(),
        email:c.email||'', phone:c.phone||'', company:c.company||'',
        address:c.address||'', group:c.group||'General', website:c.website||'',
        birthday:c.birthday||'', notes:c.notes||'', tags:c.tags||[],
        favourite:c.favourite||false, phone2:'', email2:'',
        avatarColor: COLORS[Math.floor(Math.random()*COLORS.length)],
        createdAt: new Date(), updatedAt: new Date(),
      });
      imported++;
    }
    res.json({ success:true, imported, message:`${imported} contacts imported!` });
  } catch(e) { res.status(500).json({ error: 'Import failed.' }); }
});

// ══════════════════════════════════════════════════════════
// 🎂 BIRTHDAY AUTO-NOTIFICATION SYSTEM
// ══════════════════════════════════════════════════════════

// Store sent notifications to avoid duplicate sending
const sentToday = new Set();

// GET /api/birthdays/today
app.get('/api/birthdays/today', auth, async (req, res) => {
  try {
    const all   = await contactsDB.find({ userId: req.user.id });
    const today = new Date();
    const mm    = String(today.getMonth()+1).padStart(2,'0');
    const dd    = String(today.getDate()).padStart(2,'0');
    const md    = `${mm}-${dd}`;
    const birthdays = all.filter(c => c.birthday && c.birthday.slice(5)===md);
    res.json({ birthdays, count: birthdays.length, date: md });
  } catch(e) { res.status(500).json({ error: 'Failed.' }); }
});

// GET /api/birthdays/upcoming — next 7 days
app.get('/api/birthdays/upcoming', auth, async (req, res) => {
  try {
    const all      = await contactsDB.find({ userId: req.user.id });
    const today    = new Date();
    const upcoming = [];
    for (let d = 0; d <= 7; d++) {
      const date = new Date(today);
      date.setDate(today.getDate()+d);
      const mm   = String(date.getMonth()+1).padStart(2,'0');
      const dd   = String(date.getDate()).padStart(2,'0');
      const md   = `${mm}-${dd}`;
      all.filter(c => c.birthday && c.birthday.slice(5)===md)
         .forEach(c => upcoming.push({
           ...c,
           daysLeft: d,
           label: d===0 ? 'Today!' : d===1 ? 'Tomorrow!' : `In ${d} days`
         }));
    }
    res.json({ upcoming, count: upcoming.length });
  } catch(e) { res.status(500).json({ error: 'Failed.' }); }
});

// POST /api/birthdays/check-and-notify
// Frontend calls this on login and every hour
// Returns contacts needing notification + WhatsApp deep links
app.post('/api/birthdays/check-and-notify', auth, async (req, res) => {
  try {
    const all   = await contactsDB.find({ userId: req.user.id });
    const today = new Date();
    const mm    = String(today.getMonth()+1).padStart(2,'0');
    const dd    = String(today.getDate()).padStart(2,'0');
    const md    = `${mm}-${dd}`;
    const dateKey = `${req.user.id}-${today.toDateString()}`;

    // Find today's birthdays
    const todayBdays = all.filter(c => c.birthday && c.birthday.slice(5)===md && c.phone);

    // Check which ones haven't been notified today
    const notNotified = [];
    for (const c of todayBdays) {
      const notifKey = `${dateKey}-${c._id}`;
      const alreadySent = await notifDB.findOne({ key: notifKey });
      if (!alreadySent) {
        notNotified.push(c);
      }
    }

    // Mark all as notified
    for (const c of notNotified) {
      const notifKey = `${dateKey}-${c._id}`;
      await notifDB.insert({ key: notifKey, userId: req.user.id, contactName: c.name, timestamp: new Date() });
    }

    // Clean old notifications (keep only last 30 days)
    const cutoff = new Date(Date.now() - 30*24*60*60*1000);
    await notifDB.remove({ timestamp: { $lt: cutoff } }, { multi: true });

    // Build WhatsApp links for auto-opening
    const notifications = notNotified.map(c => {
      const phone   = c.phone.replace(/[^0-9]/g,'');
      const waPhone = phone.length === 10 ? '91' + phone : phone;
      const msg     = `🎂 Happy Birthday ${c.name}! Wishing you a wonderful day filled with joy and happiness! 🎉🥳 - Sent with iAddress Pro`;
      const waLink  = `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`;
      const smsBody = encodeURIComponent(`🎂 Happy Birthday ${c.name}! Wishing you a wonderful day! 🎉`);
      const smsLink = `sms:${c.phone}?body=${smsBody}`;
      return {
        id:      c._id,
        name:    c.name,
        phone:   c.phone,
        avatar:  c.avatarColor,
        waLink,
        smsLink,
        message: `🎂 Happy Birthday ${c.name}! Wishing you a wonderful day filled with joy and happiness! 🎉🥳`
      };
    });

    res.json({
      success:       true,
      notifications,
      count:         notifications.length,
      alreadySent:   todayBdays.length - notNotified.length,
      date:          md
    });
  } catch(e) {
    console.error('[Birthday notify]', e.message);
    res.status(500).json({ error: 'Failed.' });
  }
});

// POST /api/birthdays/mark-sent
app.post('/api/birthdays/mark-sent', auth, async (req, res) => {
  try {
    const { contactId } = req.body;
    const today   = new Date();
    const dateKey = `${req.user.id}-${today.toDateString()}`;
    const notifKey = `${dateKey}-${contactId}-manual`;
    await notifDB.insert({ key: notifKey, userId: req.user.id, timestamp: new Date() });
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed.' }); }
});

// ══════════════════════════════════════════════════════════
// AI ROUTES
// ══════════════════════════════════════════════════════════

app.post('/api/ai/suggest-contact', auth, async (req, res) => {
  try {
    const { name, partialInfo } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required.' });
    let group = 'Work';
    if (partialInfo) {
      const l = partialInfo.toLowerCase();
      if (l.includes('family'))   group = 'Family';
      else if (l.includes('friend'))  group = 'Friends';
      else if (l.includes('college')) group = 'College';
      else if (l.includes('business'))group = 'Business';
    }
    const suggestion = smartAI(name, group);
    console.log(`[AI] Filled for "${name}":`, suggestion.company);
    res.json({ success: true, suggestion });
  } catch(e) { res.status(500).json({ error: 'AI failed.' }); }
});

app.post('/api/ai/smart-notes', auth, async (req, res) => {
  try {
    const { notes, company } = req.body;
    if (!notes) return res.status(400).json({ error: 'Notes required.' });
    const cap      = notes.charAt(0).toUpperCase() + notes.slice(1).trim();
    const improved = (cap.endsWith('.')?cap:cap+'.') + (company?` Works at ${company}.`:'');
    res.json({ success: true, improvedNotes: improved });
  } catch { res.status(500).json({ error: 'Failed.' }); }
});

app.post('/api/ai/conversation-starter', auth, async (req, res) => {
  try {
    const { name, company } = req.body;
    const n = name||'there';
    const c = company||'';
    res.json({ success: true, starters: [
      `Hi ${n}! Hope you are doing well. Would love to catch up soon! 😊`,
      `Hey ${n}! ${c?`How is everything going at ${c}?`:'How have things been going lately?'}`,
      `${n}, it has been a while since we connected! Let us catch up over coffee. ☕`
    ]});
  } catch { res.status(500).json({ error: 'Failed.' }); }
});

app.post('/api/ai/suggest-tags', auth, async (req, res) => {
  try {
    const { name, group } = req.body;
    const tagMap = {
      Work:['tech','developer','colleague'],Business:['business','partner','networking'],
      Friends:['friend','social','personal'],College:['college','alumni','classmate'],
      Family:['family','relative','trusted'],General:['contact','professional','important'],
    };
    const g    = tagMap[group]?group:'General';
    const tags = tagMap[g];
    const idx  = (name||'A').split('').reduce((a,c)=>a+c.charCodeAt(0),0);
    res.json({ success: true, tags: [tags[idx%tags.length], tags[(idx+1)%tags.length]] });
  } catch { res.json({ success: true, tags: ['contact','professional'] }); }
});

// ── HEALTH ────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status:'ok', version:'4.0.0', ai:'Smart Built-in (No Key)', timestamp: new Date().toISOString() });
});

app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
});

app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   iAddress Pro v4.0 — PERFECT FINAL SERVER 🚀   ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  ✅ Server:    http://localhost:${PORT}               ║`);
  console.log('║  🤖 AI:       Smart Built-in (No Key Needed)    ║');
  console.log('║  🎂 Birthdays: Auto WhatsApp notifications      ║');
  console.log('║  👤 New Users: Start with EMPTY contacts        ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
});
// ✅ AUTO BIRTHDAY CHECK
function checkAndSendBirthdayMessages() {
  const today = new Date();
  const todayStr = today.toISOString().slice(5, 10); // MM-DD

  contactsDB.find({}, async (err, contacts) => {
    if (err) return;

    for (let c of contacts) {
      if (c.birthday && c.birthday.slice(5,10) === todayStr) {
        console.log(`Sending birthday message to ${c.name}`);
        await sendWhatsApp(c.phone, `🎉 Happy Birthday ${c.name}!`);
      }
    }
  });
}

// ⏰ RUN DAILY
setInterval(checkAndSendBirthdayMessages, 86400000);