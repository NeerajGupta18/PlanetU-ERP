/**
 * Demo data. Everything here is FICTIONAL sample data (except the organisation
 * name and tagline) - replace it with real records once a real database is
 * connected. Address / phone are intentionally blank: fill them in below when
 * the real details are available and they will appear in the top bar and on
 * the Institute page automatically.
 */
import bcrypt from 'bcryptjs';
import { toISO, addDays } from '../utils/dates.js';

const hash = (plain) => bcrypt.hashSync(plain, 10);

export const DEMO_ACCOUNTS = [
  { role: 'super_admin', loginId: 'SA001', email: 'superadmin@erp.com', password: 'SuperAdmin@123' },
  { role: 'admin', loginId: 'ADM001', email: 'admin@erp.com', password: 'Admin@123' },
  { role: 'student', loginId: 'STU2026001', email: 'aarav.sharma@student.erp.com', password: 'Student@123' },
  { role: 'employee', loginId: 'EMP001', email: 'amandeep.kaur@erp.com', password: 'Employee@123' },
];

export function buildSeed() {
  const year = new Date().getFullYear();

  const institute = {
    id: 'INST-001',
    name: 'PlanetU Technovision',
    shortName: 'PlanetU',
    tagline: 'Elevating ideas into digital success',
    address: '',
    city: '',
    state: '',
    pincode: '',
    phone: '',
    email: 'info@planetu.example',
    website: 'www.planetu.example',
    details: {
      'Organisation Type': 'Technology & Training Organisation',
      'Organisation Code': 'PUT-001',
      'Registration No.': 'SAMPLE/0001',
      'Working Model': 'Hybrid (Online + Offline)',
      'Program Session': `${year}-${String(year + 1).slice(2)}`,
    },
    stakeholders: [
      { name: 'Mr. Harjinder Singh', role: 'Director', email: 'director@planetu.example', phone: '+91 90000 11111' },
      { name: 'Dr. Manpreet Kaur', role: 'Program Head', email: 'programs@planetu.example', phone: '+91 90000 22222' },
      { name: 'Mr. Sandeep Verma', role: 'Operations Manager', email: 'operations@planetu.example', phone: '+91 90000 33333' },
      { name: 'Ms. Navneet Kaur', role: 'Accounts Officer', email: 'accounts@planetu.example', phone: '+91 90000 44444' },
    ],
    authorizedPersons: [
      { name: 'Dr. Manpreet Kaur', designation: 'Program Head', email: 'programs@planetu.example', phone: '+91 90000 22222', pan: 'ABCDE****F', aadhaar: 'XXXX-XXXX-1234' },
      { name: 'Mr. Sandeep Verma', designation: 'Operations Manager', email: 'operations@planetu.example', phone: '+91 90000 33333', pan: 'FGHIJ****K', aadhaar: 'XXXX-XXXX-5678' },
    ],
    documents: [
      { name: 'Certificate of Incorporation', issuedBy: 'Registrar of Companies', validTill: null, status: 'Verified' },
      { name: 'GST Registration', issuedBy: 'GST Department', validTill: null, status: 'Verified' },
      { name: 'Shops & Establishment Licence', issuedBy: 'Local Authority', validTill: `${year + 1}-06-30`, status: 'Verified' },
      { name: 'Fire Safety NOC', issuedBy: 'Fire Department', validTill: `${year + 1}-01-15`, status: 'Expiring soon' },
      { name: 'PAN Card (Organisation)', issuedBy: 'Income Tax Department', validTill: null, status: 'Verified' },
    ],
    beneficiaries: [
      { accountName: 'PlanetU Technovision - Fee Collection', bank: 'State Bank of India', branch: 'Main Branch', accountNumber: 'XXXXXX4821', ifsc: 'SBIN0001234', type: 'Current' },
      { accountName: 'PlanetU Technovision - Scholarship', bank: 'Punjab National Bank', branch: 'Main Branch', accountNumber: 'XXXXXX9057', ifsc: 'PUNB0123400', type: 'Savings' },
    ],
    stamp: {
      stampText: 'PLANETU TECHNOVISION',
      stampSub: 'ELEVATING IDEAS',
      signatory: 'Dr. Manpreet Kaur',
      signatoryTitle: 'Program Head',
    },
  };

  const courses = [
    { id: 'BCA', name: 'BCA', fullName: 'Bachelor of Computer Applications', department: 'Computer Science', years: 3 },
  ];

  const employees = [
    { id: 'EMP001', name: 'Amandeep Kaur', designation: 'Professor', department: 'Computer Science', shift: 'Employee shift', email: 'amandeep.kaur@erp.com' },
    { id: 'EMP002', name: 'Rohit Verma', designation: 'Associate Professor', department: 'Computer Science', shift: 'Employee shift', email: 'rohit.verma@erp.com' },
    { id: 'EMP003', name: 'Simran Kaur', designation: 'Assistant Professor', department: 'Computer Science', shift: 'Employee shift', email: 'simran.kaur@erp.com' },
    { id: 'EMP004', name: 'Harshit Rana', designation: 'Assistant Professor', department: 'Computer Science', shift: 'Employee shift', email: 'harshit.rana@erp.com' },
    { id: 'EMP005', name: 'Muskaan Arora', designation: 'Head of Department', department: 'English', shift: 'General shift', email: 'muskaan.arora@erp.com' },
    { id: 'EMP006', name: 'Kavita Sharma', designation: 'Associate Professor', department: 'Mathematics', shift: 'General shift', email: 'kavita.sharma@erp.com' },
  ];

  // Departments & Designations are reference lists managed from the Admin
  // portal. Employees still store department/designation as plain strings
  // (unchanged, so the existing timetable service and student pages keep
  // working untouched) - these names must match here.
  const departments = [
    { id: 'DEPT-CS', name: 'Computer Science', description: 'All Computer Science courses', createdDate: `${year}-01-15` },
    { id: 'DEPT-EN', name: 'English', description: 'English language and communication', createdDate: `${year}-01-15` },
    { id: 'DEPT-MA', name: 'Mathematics', description: 'Mathematics and applied sciences', createdDate: `${year}-01-15` },
    { id: 'DEPT-AD', name: 'Administration', description: 'Administrative and support staff', createdDate: `${year}-01-15` },
  ];

  const designations = [
    { id: 'DESG-1', name: 'Professor', department: 'Computer Science' },
    { id: 'DESG-2', name: 'Associate Professor', department: 'Computer Science' },
    { id: 'DESG-3', name: 'Assistant Professor', department: 'Computer Science' },
    { id: 'DESG-4', name: 'Head of Department', department: 'English' },
    { id: 'DESG-5', name: 'Associate Professor', department: 'Mathematics' },
  ];

  const students = [
    {
      id: 'STU2026001', rollNo: 'BCA24-001', enrollmentNo: 'ENR2024BCA001',
      name: 'Aarav Sharma', email: 'aarav.sharma@student.erp.com', phone: '+91 98123 45601',
      dob: '2005-03-14', gender: 'Male', bloodGroup: 'B+', nationality: 'Indian',
      courseId: 'BCA', semester: 3, section: 'A', batch: '2024 - 2027', admissionDate: '2024-07-15',
      status: 'Active',
      address: '#214, Karve Nagar, Pune, Maharashtra - 411052',
      guardian: { name: 'Rajesh Sharma', relation: 'Father', phone: '+91 98123 45600', email: 'rajesh.sharma@example.com' },
      attendance: [
        { subject: 'Python Programming', attended: 34, total: 38 },
        { subject: 'Data Structures', attended: 30, total: 36 },
        { subject: 'Database Management', attended: 28, total: 34 },
        { subject: 'Web Technologies', attended: 26, total: 32 },
        { subject: 'English Communication', attended: 20, total: 22 },
        { subject: 'Discrete Mathematics', attended: 24, total: 30 },
      ],
    },
    {
      id: 'STU2026002', rollNo: 'BCA24-002', enrollmentNo: 'ENR2024BCA002',
      name: 'Simran Gill', email: 'simran.gill@student.erp.com', phone: '+91 98123 45602',
      dob: '2005-08-02', gender: 'Female', bloodGroup: 'O+', nationality: 'Indian',
      courseId: 'BCA', semester: 3, section: 'A', batch: '2024 - 2027', admissionDate: '2024-07-15',
      status: 'Active', address: '#12, Green Avenue, Wakad, Pune, Maharashtra - 411057',
      guardian: { name: 'Gurdeep Gill', relation: 'Father', phone: '+91 98123 45610', email: 'gurdeep.gill@example.com' },
      attendance: [
        { subject: 'Python Programming', attended: 36, total: 38 },
        { subject: 'Data Structures', attended: 33, total: 36 },
        { subject: 'Database Management', attended: 31, total: 34 },
        { subject: 'Web Technologies', attended: 30, total: 32 },
        { subject: 'English Communication', attended: 21, total: 22 },
        { subject: 'Discrete Mathematics', attended: 27, total: 30 },
      ],
    },
    {
      id: 'STU2026003', rollNo: 'BCA24-003', enrollmentNo: 'ENR2024BCA003',
      name: 'Karan Mehta', email: 'karan.mehta@student.erp.com', phone: '+91 98123 45603',
      dob: '2004-12-21', gender: 'Male', bloodGroup: 'A+', nationality: 'Indian',
      courseId: 'BCA', semester: 3, section: 'A', batch: '2024 - 2027', admissionDate: '2024-07-16',
      status: 'Active', address: '#88, Sector 4, Pimpri, Pune, Maharashtra - 411018',
      guardian: { name: 'Anil Mehta', relation: 'Father', phone: '+91 98123 45620', email: 'anil.mehta@example.com' },
      attendance: [
        { subject: 'Python Programming', attended: 30, total: 38 },
        { subject: 'Data Structures', attended: 27, total: 36 },
        { subject: 'Database Management', attended: 25, total: 34 },
        { subject: 'Web Technologies', attended: 24, total: 32 },
        { subject: 'English Communication', attended: 18, total: 22 },
        { subject: 'Discrete Mathematics', attended: 22, total: 30 },
      ],
    },
  ];

  const users = [
    { id: 'U-SA-1', role: 'super_admin', loginId: 'SA001', email: 'superadmin@erp.com', name: 'Super Admin', passwordHash: hash('SuperAdmin@123'), profileId: null, status: 'active' },
    { id: 'U-AD-1', role: 'admin', loginId: 'ADM001', email: 'admin@erp.com', name: 'Institute Admin', passwordHash: hash('Admin@123'), profileId: null, status: 'active' },
    ...students.map((s) => ({
      id: `U-${s.id}`, role: 'student', loginId: s.id, email: s.email, name: s.name,
      passwordHash: hash('Student@123'), profileId: s.id, status: 'active',
    })),
    ...employees.map((e) => ({
      id: `U-${e.id}`, role: 'employee', loginId: e.id, email: e.email, name: e.name,
      passwordHash: hash('Employee@123'), profileId: e.id, status: 'active',
    })),
  ];

  // Weekly repeating timetable for BCA / Semester 3 / Section A. weekday: 1 = Mon ... 5 = Fri
  const periods = [
    ['09:00', '10:00'], ['10:00', '11:00'], ['11:15', '12:15'], ['12:15', '13:15'],
  ];
  const subjects = {
    py: { title: 'Python Programming', emp: 'EMP001' },
    ds: { title: 'Data Structures', emp: 'EMP002' },
    db: { title: 'Database Management', emp: 'EMP003' },
    wt: { title: 'Web Technologies', emp: 'EMP004' },
    en: { title: 'English Communication', emp: 'EMP005' },
    ma: { title: 'Discrete Mathematics', emp: 'EMP006' },
  };
  const grid = {
    1: ['py', 'ds', 'ma', 'en'],
    2: ['db', 'py', 'wt', 'ds'],
    3: ['ma', 'db', 'en', 'wt'],
    4: ['ds', 'wt', 'py', 'db'],
    5: ['en', 'ma', 'py', 'ds'],
  };
  const labs = new Set(['3-3', '4-2', '4-3']); // "weekday-period" combos that are lab sessions
  const timetableSlots = [];
  Object.entries(grid).forEach(([weekday, keys]) => {
    keys.forEach((key, i) => {
      const s = subjects[key];
      const isLab = labs.has(`${weekday}-${i + 1}`);
      const online = key === 'en';
      timetableSlots.push({
        id: `SLOT-${weekday}${i + 1}`,
        courseId: 'BCA',
        weekday: Number(weekday),
        start: periods[i][0],
        end: periods[i][1],
        subject: isLab ? `${s.title} (Lab)` : s.title,
        employeeId: s.emp,
        mode: online ? 'Online' : 'Offline',
        location: online ? 'Google Meet' : isLab ? 'Computer Lab 2 - Block C' : 'Room 112-A3 - Main Block',
        type: 'lecture',
      });
    });
  });

  const duties = [
    { id: 'DUTY-1', courseId: 'BCA', title: 'Mid-Semester Exam Invigilation', employeeId: 'EMP002', start: '10:00', end: '13:00', priority: 'High', location: 'Exam Hall 1', rel: 10 },
    { id: 'DUTY-2', courseId: 'BCA', title: 'Computer Lab Inspection', employeeId: 'EMP004', start: '14:00', end: '15:00', priority: 'Medium', location: 'Computer Lab 2 - Block C', rel: 4 },
    { id: 'DUTY-3', courseId: 'BCA', title: 'Internal Marks Moderation', employeeId: 'EMP001', start: '11:00', end: '12:00', priority: 'Low', location: 'Staff Room', rel: 12 },
  ];

  // Fixed-date national holidays for last / this / next year
  const fixedHolidays = [
    ['01-26', 'Republic Day'], ['04-14', 'Dr. B. R. Ambedkar Jayanti'], ['08-15', 'Independence Day'],
    ['10-02', 'Gandhi Jayanti'], ['12-25', 'Christmas'],
  ];
  const events = [];
  let n = 1;
  for (const y of [year - 1, year, year + 1]) {
    for (const [md, title] of fixedHolidays) {
      events.push({ id: `EVT-${n++}`, title, type: 'holiday', start: `${y}-${md}`, end: `${y}-${md}`, allDay: true, location: null, description: 'Institute closed. Public holiday.', audience: 'all' });
    }
  }
  // A few lunar-calendar holidays (sample dates for 2026)
  [['2026-10-20', 'Dussehra'], ['2026-11-08', 'Diwali'], ['2026-11-24', 'Guru Nanak Gurpurab']].forEach(([d, title]) => {
    events.push({ id: `EVT-${n++}`, title, type: 'holiday', start: d, end: d, allDay: true, location: null, description: 'Institute closed. Public holiday.', audience: 'all' });
  });
  // Rolling events, always relative to today (see refreshDemoDates)
  [
    { title: 'Parent-Teacher Meeting', type: 'academic', rel: [-5], time: ['10:00', '13:00'], location: 'Main Auditorium', description: 'Semester 3 progress discussion with parents.' },
    { title: 'Guest Lecture: Applied AI in Industry', type: 'event', rel: [3], time: ['11:00', '12:30'], location: 'Seminar Hall', description: 'Industry speaker session open to all BCA and MCA students.' },
    { title: 'Fee Payment - Last Date', type: 'deadline', rel: [7], time: null, location: null, description: 'Pay the semester fee before this date to avoid a late fine.' },
    { title: 'Mid-Semester Examinations', type: 'exam', rel: [10, 15], time: ['10:00', '13:00'], location: 'Exam Halls 1-3', description: 'Admit cards will be available a week before the exams.' },
    { title: 'Project Synopsis Submission', type: 'deadline', rel: [14], time: null, location: null, description: 'Submit the synopsis to your project guide.' },
    { title: 'Technovision Tech Fest', type: 'event', rel: [21, 22], time: ['09:30', '17:00'], location: 'Main Campus', description: 'Hackathon, project showcase and coding contests.' },
    { title: 'Annual Sports Day', type: 'event', rel: [32], time: ['08:00', '16:00'], location: 'Campus Ground', description: 'Track and field events and inter-department matches.' },
    { title: 'End-Semester Examinations', type: 'exam', rel: [62, 74], time: ['10:00', '13:00'], location: 'Exam Halls 1-3', description: 'Detailed date sheet will be shared by the exam cell.' },
  ].forEach((e) => {
    events.push({
      id: `EVT-${n++}`, title: e.title, type: e.type, rel: e.rel, start: null, end: null,
      allDay: !e.time, startTime: e.time?.[0] ?? null, endTime: e.time?.[1] ?? null,
      location: e.location, description: e.description, audience: 'student',
    });
  });

  const notices = [
    { id: 'NTC-1', title: 'Mid-semester examination schedule released', body: 'The date sheet for the mid-semester examinations is available on the Calendar page.', category: 'Exam', rel: -1 },
    { id: 'NTC-2', title: 'Library timings extended', body: 'The central library will stay open until 7:00 PM on all working days during exam preparation.', category: 'General', rel: -3 },
    { id: 'NTC-3', title: 'Technovision registrations open', body: 'Register your team for the hackathon at the department office.', category: 'Event', rel: -4 },
    { id: 'NTC-4', title: 'Semester fee reminder', body: 'Please clear pending dues before the last date shown on the Calendar.', category: 'Fees', rel: -6 },
  ];

  return refreshDemoDates({
    meta: { version: 1, seededAt: new Date().toISOString() },
    institute, courses, employees, students, users, timetableSlots, duties, events, notices, reassignments: [],
    departments, designations,
  });
}

/**
 * Fills in collections that didn't exist in an already-seeded db.json from
 * before the Admin module was added, so upgrading never wipes existing data.
 * Safe to call on every load - a no-op once the fields are present.
 */
export function migrate(data) {
  if (!data.departments) {
    const names = [...new Set(data.employees.map((e) => e.department))];
    data.departments = names.map((name, i) => ({
      id: `DEPT-${i + 1}`, name, description: '', createdDate: toISO(new Date()),
    }));
  }
  if (!data.designations) {
    const seen = new Set();
    data.designations = [];
    let n = 1;
    for (const e of data.employees) {
      const key = `${e.designation}|${e.department}`;
      if (seen.has(key)) continue;
      seen.add(key);
      data.designations.push({ id: `DESG-${n++}`, name: e.designation, department: e.department });
    }
  }
  return data;
}

/**
 * Re-anchors rolling demo data (relative events, duties, notices and the sample
 * lecture reassignment) to today's date so the UI always has something to show.
 * Remove this once the app is connected to real data.
 */
export function refreshDemoDates(data) {
  const now = new Date();
  const at = (offset) => toISO(addDays(now, offset));

  for (const e of data.events) {
    if (e.rel) {
      e.start = at(e.rel[0]);
      e.end = at(e.rel[1] ?? e.rel[0]);
    }
  }
  for (const d of data.duties) if (d.rel != null) d.date = at(d.rel);
  for (const n of data.notices) if (n.rel != null) n.date = at(n.rel);

  // Sample "lecture reassigned" case on the next working day (second period of the day)
  const holidays = new Set(data.events.filter((e) => e.type === 'holiday').map((e) => e.start));
  let day = new Date(now);
  for (let i = 0; i < 10; i += 1) {
    const wd = day.getDay();
    if (wd >= 1 && wd <= 5 && !holidays.has(toISO(day))) break;
    day = addDays(day, 1);
  }
  const target = data.timetableSlots
    .filter((s) => s.courseId === 'BCA' && s.weekday === day.getDay())
    .sort((a, b) => a.start.localeCompare(b.start))[1];
  data.reassignments = target
    ? [{ slotId: target.id, date: toISO(day), toEmployeeId: target.employeeId === 'EMP004' ? 'EMP003' : 'EMP004', reason: 'Faculty on leave' }]
    : [];
  return data;
}
