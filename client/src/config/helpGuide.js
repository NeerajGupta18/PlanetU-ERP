/**
 * "How to use" guide: short steps for the everyday tasks of each role. Each guide names the page it starts on (the
 * same words as the menu) and links there. `who` says which users see it: a login role ('admin', 'employee',
 * 'student', 'parent', 'super_admin'), 'teaching' (staff who teach), or an office area from a staff role
 * ('area:fees', 'area:library', ...). `module` hides a guide when the institute has that module switched off.
 */
export const HELP = [
  /* ---------------- everyone ---------------- */
  {
    id: 'find', who: ['admin', 'employee', 'student', 'parent', 'super_admin'], title: 'Find any page quickly',
    steps: [
      'Press Ctrl + K (Cmd + K on a Mac), or tap the search button at the top.',
      'Type a few letters of what you want, such as "fees" or "leave".',
      'Press Enter or tap the result to open it.',
      'On a phone, the bar at the bottom has your most used pages. "Menu" opens everything else.',
    ],
  },
  {
    id: 'bell', who: ['admin', 'employee', 'student', 'parent'], title: 'See what is new (the bell)',
    steps: [
      'The red number on the bell shows messages you have not read.',
      'Open the bell to see them: leave decisions, absences, fee reminders, new work and more.',
      'Tap a message to go to the page it is about. "Mark all read" clears the number.',
    ],
  },

  /* ---------------- institute admin and principal ---------------- */
  {
    id: 'admin-dashboard', who: ['admin', 'area:dashboard'], title: 'Read the dashboard', to: '/admin/dashboard',
    steps: [
      'The six cards at the top are the day\'s key numbers. Green means fine, amber means something to do, red means urgent.',
      'Each card compares with last week or last month, so you can see if things are getting better or worse.',
      '"Needs your attention" lists everything waiting, most urgent first. Tap a line to deal with it.',
      'The two charts show fees collected each month and student attendance each week.',
    ],
  },
  {
    id: 'approvals', who: ['admin', 'area:approvals'], title: 'Approve leave, certificates and applications', to: '/admin/approvals',
    steps: [
      'Open Approvals in the menu. The red number shows how many are waiting.',
      'Leave requests can be approved or rejected right there. Add a remark if you reject.',
      'Certificates, applications and grievances open on their own pages when you tap them.',
    ],
  },
  {
    id: 'admissions', who: ['admin', 'area:admissions'], title: 'Review and enrol applicants', module: 'admissions', to: '/admin/admissions',
    steps: [
      'Open Admissions. New applications show as "Submitted".',
      'Open one to check the details and documents, then choose Accept, Waitlist or Reject.',
      'For an accepted applicant, choose "Enrol student". This creates the student record, their ID and their login.',
      'Use Walk-in to enter an application for someone who comes to the office.',
    ],
  },
  {
    id: 'students', who: ['admin', 'area:students'], title: 'Look up a student', module: 'students', to: '/admin/students',
    steps: [
      'Open Students and type a name, roll number or ID in the search box.',
      'Choose View. The record shows attendance, fees due and the latest result at a glance.',
      'Tap the fees card to open that student\'s fee ledger, or the attendance card for reports.',
      'You can change the section, semester, phone or status, and download the ID card.',
    ],
  },
  {
    id: 'staff-roles', who: ['admin'], title: 'Give office staff their roles', to: '/admin/staff-roles',
    steps: [
      'Open Staff roles (under Staff).',
      'Choose the employee and the role, for example Accountant or Librarian. A head of department also needs a department.',
      'They sign in with their normal employee login and see only the pages of their role.',
    ],
  },
  {
    id: 'notices', who: ['admin', 'area:notices'], title: 'Post a notice', module: 'notices', to: '/admin/notices',
    steps: [
      'Open Notices and choose "New notice".',
      'Write the title and message, choose who should see it (everyone, students or staff) and the date.',
      'Mark it Important to show it in red, or tick "Pin to the top" to keep it first.',
    ],
  },
  {
    id: 'reports', who: ['admin', 'area:reports'], title: 'Download a report', to: '/admin/reports',
    steps: [
      'Open Reports & Exports.',
      'Pick a report, for example attendance below 75% or outstanding fees.',
      'Set the filters, then download it as Excel, CSV or PDF.',
    ],
  },

  /* ---------------- fees (admin and accountant) ---------------- */
  {
    id: 'record-payment', who: ['admin', 'area:fees'], title: 'Record a fee payment', module: 'fees', to: '/admin/fees?tab=students',
    steps: [
      'Open Fees & Payments and choose "Record a payment".',
      'Type the student\'s name or ID and pick them from the list.',
      'Choose "Record payment", check the amount, pick the method (cash, UPI, card, cheque) and save.',
      'The money is applied to the oldest dues first. A receipt is made at once and the student can download it.',
    ],
  },
  {
    id: 'fee-dues', who: ['admin', 'area:fees'], title: 'Follow up on overdue fees', module: 'fees', to: '/admin/fees',
    steps: [
      'The Overview tab shows who is overdue, oldest first.',
      'Choose "Open ledger" on a student to see each charge and payment.',
      'Students and parents also get reminders in the app before and after the due date.',
    ],
  },
  {
    id: 'fee-structure', who: ['admin', 'area:fees'], title: 'Set up fees for a course', module: 'fees', to: '/admin/fees?tab=structures',
    steps: [
      'Open the Fee structures tab and choose "New structure".',
      'Pick the course and year, then add each charge with its amount and due date.',
      'Then assign it, which charges every student of that course.',
    ],
  },
  {
    id: 'online-check', who: ['admin', 'area:fees'], title: 'Check an online payment', module: 'fees', to: '/admin/fees?tab=online',
    steps: [
      'Open the Online payments tab. Payments that need checking are listed first.',
      'Compare with the bank or gateway statement, then settle it so the student\'s ledger is updated.',
    ],
  },
  {
    id: 'payroll', who: ['admin', 'area:payroll'], title: 'Run the monthly payroll', module: 'payroll', to: '/admin/payroll',
    steps: [
      'Open Payroll and make sure every employee has a salary set.',
      'Choose "Run payroll" for the month. Unpaid leave is taken off automatically.',
      'Check the draft, then Finalise. Staff can then download their payslips.',
    ],
  },

  /* ---------------- head of department ---------------- */
  {
    id: 'hod-leave', who: ['hod'], title: 'Decide leave for your department', module: 'leave', to: '/admin/leave',
    steps: [
      'Open Department leave. The Waiting tab shows requests from your department.',
      'Check the dates and reason, then Approve or Reject (add a remark if you reject).',
      'The Balances tab shows how much leave each person has left.',
    ],
  },
  {
    id: 'hod-att', who: ['hod'], title: 'Check your department\'s attendance', module: 'attendance', to: '/admin/attendance',
    steps: [
      'Your home page shows the department\'s attendance this week and students below 75%.',
      'Open Department attendance to see each class and lecture.',
    ],
  },

  /* ---------------- other office desks ---------------- */
  {
    id: 'library', who: ['admin', 'area:library'], title: 'Issue and return a book', module: 'library', to: '/admin/library',
    steps: [
      'Open Library and choose "Issue a book".',
      'Search the book, then the student or staff member, check the due date and save.',
      'To take a book back, open the "On loan" tab and choose Return. Overdue books are shown first, with any fine.',
    ],
  },
  {
    id: 'visitors', who: ['admin', 'area:visitors'], title: 'Check a visitor in and out', module: 'visitors', to: '/admin/visitors',
    steps: [
      'Open Visitors and choose "Add visitor". Fill in the name, phone, purpose and who they are meeting.',
      'Leave "Arrived now" ticked if they are at the gate and choose Check in. The visitor pass prints.',
      'When they leave, find them under "At the gate" and choose "Check out".',
      'Staff can pre-register their guests, who then show as "Expected" at the gate.',
    ],
  },
  {
    id: 'hostel', who: ['admin', 'area:hostel'], title: 'Give a student a hostel room', module: 'hostel', to: '/admin/hostel',
    steps: [
      'Open Hostel and choose "Allot a room".',
      'Pick the student and a room with a free bed. Move or Vacate them later from the residents list.',
    ],
  },
  {
    id: 'transport', who: ['admin', 'area:transport'], title: 'Add a student to a bus route', module: 'transport', to: '/admin/transport',
    steps: [
      'Open Transport and choose "Add a rider".',
      'Pick the student, the route and their stop. Use "Change stop" or "End" when things change.',
    ],
  },
  {
    id: 'placement', who: ['admin', 'area:placement'], title: 'Run a placement drive', module: 'placement', to: '/admin/placement',
    steps: [
      'Add the company, then a drive with the date, package and who can apply.',
      'Open the drive to the students. Shortlist and select applicants as the drive goes on.',
    ],
  },
  {
    id: 'certificates', who: ['admin', 'area:certificates'], title: 'Issue a certificate', module: 'certificates', to: '/admin/certificates',
    steps: [
      'Open Certificates. Requests from students are listed as waiting.',
      'Check the details and choose Issue. The student can then download it.',
    ],
  },
  {
    id: 'exam-cell', who: ['admin', 'area:exams'], title: 'Publish exam results', module: 'exams', to: '/admin/exams',
    steps: [
      'Open Exams and results and the exam. The step bar says what is next.',
      'Each paper shows a progress bar of marks entered. Remind the teacher if one is still pending.',
      '"Before you publish" lists the checks. When every student has a mark or Absent in every paper, choose "Publish results". Students and parents then see the results and report cards.',
      'Then choose "Print report cards". They carry your institute\'s logo.',
    ],
  },

  /* ---------------- teaching staff ---------------- */
  {
    id: 'mark', who: ['teaching'], title: 'Mark attendance', module: 'attendance', to: '/employee/attendance',
    steps: [
      'Open Mark attendance. In a college or university it lists only the lectures assigned to you today; in a school, the class teacher sees the class register for the day.',
      'Tap "Mark attendance" (your next lecture is at the top of your home screen). Tap only the few who are absent (A) or late (L).',
      'Choose "Review and submit": everyone you did not tap is marked present. Check the names, then "Submit attendance". Students and parents of absent students are told at once.',
      'After submitting, the button takes you straight to your next lecture.',
      'In a college or university you can also start a QR check-in: choose how long it stays open, show the QR on the projector, and students scan it inside the app. Schools do not use this.',
    ],
  },
  {
    id: 'grade', who: ['teaching'], title: 'Set and grade an assignment', module: 'assignments', to: '/employee/assignments',
    steps: [
      'Open Coursework, then "New assignment". Pick the class and subject, the due date and the marks, then "Save and publish".',
      'When students hand in, open the assignment and grade each answer. You can also send one back to redo.',
    ],
  },
  {
    id: 'marks', who: ['teaching'], title: 'Enter exam marks', module: 'exams', to: '/employee/exams',
    steps: [
      'Open Exam marks. Papers waiting for your marks are at the top.',
      'Enter each student\'s marks (or tick Absent) and save as you go.',
      'Choose "Submit marks" when the paper is complete.',
    ],
  },

  /* ---------------- every employee ---------------- */
  {
    id: 'apply-leave', who: ['employee'], title: 'Apply for leave', module: 'leave', to: '/employee/leave',
    steps: [
      'Open Leave (My leave). Your balance for each type is shown at the top.',
      'Choose "Apply for leave", pick the type and dates (or a half day) and give a reason.',
      'You are told in the app when it is approved or rejected.',
    ],
  },
  {
    id: 'payslip', who: ['employee'], title: 'Download a payslip', module: 'payroll', to: '/employee/payslips',
    steps: ['Open My payslips and choose the month. Payslips appear once the office finalises the payroll.'],
  },

  /* ---------------- students ---------------- */
  {
    id: 'student-home', who: ['student'], title: 'Your home page', to: '/student/dashboard',
    steps: [
      'The cards show your attendance, next class, work due this week, fees due, next exam and latest result.',
      'The attendance card tells you how many classes you can still miss, or how many you must attend to reach 75%.',
      '"To do" lists what to do next, most urgent first.',
    ],
  },
  {
    id: 'hand-in', who: ['student'], title: 'Hand in an assignment', module: 'assignments', to: '/student/assignments',
    steps: [
      'Open Coursework. Work you still have to hand in says "To do".',
      'Choose "Open and hand in", write your answer or attach a file, and submit.',
      'Your marks and the teacher\'s comments appear there once it is graded.',
    ],
  },
  {
    id: 'student-att', who: ['student'], title: 'Check your attendance', module: 'attendance', to: '/student/attendance',
    steps: [
      'Open Attendance to see each subject. Red means below 75%, amber means close to it.',
      'If your teacher starts a QR check-in, open Scan in the PlanetU app, tap Scan QR code and point the camera at the projector. You will see "Attendance marked successfully". The code changes every few seconds, so a photo will not work.',
    ],
  },
  {
    id: 'student-fees', who: ['student', 'parent'], title: 'Pay fees and get receipts', module: 'fees', to: '/student/fees',
    steps: [
      'Open Fees to see each charge, its due date and what is paid.',
      'If online payment is on, choose "Pay online". Otherwise pay at the fee counter.',
      'Every payment has a receipt you can download under "Payments & receipts".',
    ],
  },
  {
    id: 'results', who: ['student', 'parent'], title: 'See exam results', module: 'exams', to: '/student/results',
    steps: ['Open Results once the institute publishes them. You can download the report card from there.'],
  },
  {
    id: 'certificate-request', who: ['student'], title: 'Ask for a certificate', module: 'certificates', to: '/student/certificates',
    steps: ['Open Certificates and choose Request next to the one you need (for example bonafide).', 'Say what it is needed for and choose "Send request". Download it here once the office issues it.'],
  },

  /* ---------------- parents ---------------- */
  {
    id: 'parent-home', who: ['parent'], title: 'Your children at a glance', to: '/parent/home',
    steps: [
      'Each child has a card: present or absent today, attendance, fees due, latest result and next exam.',
      'If you have more than one child linked, switch between them with "Child" at the top.',
      'Tap Attendance, Results or Fees on a card to see the details for that child.',
    ],
  },

  /* ---------------- platform owner ---------------- */
  {
    id: 'platform', who: ['super_admin'], title: 'Look after the institutes', to: '/super-admin/dashboard',
    steps: [
      'The dashboard shows money received, overdue invoices, trials ending and institutes nobody has signed in to.',
      'Open Institutes to add one, change its modules or suspend it.',
      'Open Billing for plans, invoices and payments.',
    ],
  },
  {
    id: 'add-institute', who: ['super_admin'], title: 'Add a new institute', to: '/super-admin/institutes',
    steps: [
      'Open Institutes and choose "Add institute". Pick the type (school, college, university) to preset the modules.',
      'Enter the admin\'s name and email. They get a link to set their password.',
    ],
  },
];

/** The guides for this user: by login role, teaching, staff areas and switched-on modules. */
export function guidesFor(user, office, hasModule) {
  const tags = new Set([user.role]);
  if (user.role === 'employee' && office?.teaching !== false) tags.add('teaching');
  for (const [area, g] of Object.entries(office?.areas || {})) {
    if (g.scope === 'all') tags.add(`area:${area}`);
    else tags.add('hod');
  }
  if (office?.reportGroups?.length) tags.add('area:reports');
  const GENERAL = ['find', 'bell'];
  const list = HELP.filter((h) => h.who.some((w) => tags.has(w)) && (!h.module || hasModule(h.module)));
  // The guides for this person's own work first, the general ones (search, the bell) last
  return [...list.filter((h) => !GENERAL.includes(h.id)), ...list.filter((h) => GENERAL.includes(h.id))];
}
