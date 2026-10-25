/**
 * Fictional demo clients - one college, one school, one university - so the
 * platform's isolation and per-type configuration can be shown side by side.
 * The SAME login IDs (ADM001, EMP001, ...) exist in every tenant on purpose:
 * only the institute code decides whose data you get.
 */
import crypto from 'node:crypto';

const year = new Date().getFullYear();
const p2 = (n) => String(n).padStart(2, '0');
const p3 = (n) => String(n).padStart(3, '0');
const p4 = (n) => String(n).padStart(4, '0');
const session = `${year}-${String(year + 1).slice(2)}`;

const college = {
  code: 'demo-college', name: 'Horizon College of Technology', type: 'college', shortName: 'Horizon',
  institute: {
    tagline: 'Where curiosity meets craft', email: 'info@horizon.example', website: 'www.horizon.example',
    address: 'Survey No. 12, Karve Road, Kothrud', city: 'Pune', phone: '+91 20 4000 1000',
    details: {
      'Organisation Type': 'Affiliated College', 'Organisation Code': 'HCT-001', 'Registration No.': 'SAMPLE/0001',
      'Working Model': 'Offline', 'Program Session': session,
    },
    stakeholders: [
      { name: 'Dr. Harjinder Singh', role: 'Principal', email: 'principal@horizon.example', phone: '+91 90000 11111' },
      { name: 'Dr. Manpreet Kaur', role: 'Vice Principal', email: 'vp@horizon.example', phone: '+91 90000 22222' },
      { name: 'Mr. Sandeep Verma', role: 'Registrar', email: 'registrar@horizon.example', phone: '+91 90000 33333' },
    ],
    authorizedPersons: [
      { name: 'Dr. Manpreet Kaur', designation: 'Vice Principal', email: 'vp@horizon.example', phone: '+91 90000 22222', pan: 'ABCDE****F', aadhaar: 'XXXX-XXXX-1234' },
      { name: 'Mr. Sandeep Verma', designation: 'Registrar', email: 'registrar@horizon.example', phone: '+91 90000 33333', pan: 'FGHIJ****K', aadhaar: 'XXXX-XXXX-5678' },
    ],
    documents: [
      { name: 'University Affiliation Certificate', issuedBy: 'State University', validTill: `${year + 2}-06-30`, status: 'Verified' },
      { name: 'Fire Safety NOC', issuedBy: 'Fire Department', validTill: `${year + 1}-01-15`, status: 'Expiring soon' },
      { name: 'Trust Registration', issuedBy: 'Charity Commissioner', validTill: null, status: 'Verified' },
    ],
    beneficiaries: [
      { accountName: 'Horizon College - Fee Collection', bank: 'State Bank of India', branch: 'Main Branch', accountNumber: 'XXXXXX4821', ifsc: 'SBIN0001234', type: 'Current' },
    ],
    stamp: { stampText: 'HORIZON COLLEGE OF TECHNOLOGY', stampSub: 'ESTD. 1998', signatory: 'Dr. Harjinder Singh', signatoryTitle: 'Principal' },
  },
  admin: { loginId: 'ADM001', email: 'admin@horizon.example', name: 'Institute Admin' },
  departments: [
    ['Computer Science', 'All Computer Science courses'], ['English', 'English language and communication'],
    ['Mathematics', 'Mathematics and applied sciences'], ['Administration', 'Administrative and support staff'],
  ],
  designations: [
    ['Professor', 'Computer Science'], ['Associate Professor', 'Computer Science'], ['Assistant Professor', 'Computer Science'],
    ['Head of Department', 'English'], ['Associate Professor', 'Mathematics'],
    ['Assistant Professor', 'English'], ['Assistant Professor', 'Mathematics'],
  ],
  employees: [
    ['EMP001', 'Amandeep Kaur', 'Professor', 'Computer Science', 'Employee shift'],
    ['EMP002', 'Rohit Verma', 'Associate Professor', 'Computer Science', 'Employee shift'],
    ['EMP003', 'Simran Kaur', 'Assistant Professor', 'Computer Science', 'Employee shift'],
    ['EMP004', 'Harshit Rana', 'Assistant Professor', 'Computer Science', 'Employee shift'],
    ['EMP005', 'Muskaan Arora', 'Head of Department', 'English', 'General shift'],
    ['EMP006', 'Kavita Sharma', 'Associate Professor', 'Mathematics', 'General shift'],
  ],
  // A second set of teachers, one per subject. Division A is taught by the first six, division B by these, division C by a mix.
  moreEmployees: [
    ['EMP012', 'Vikas Malhotra', 'Associate Professor', 'Computer Science', 'Employee shift'],
    ['EMP013', 'Pallavi Nair', 'Assistant Professor', 'Computer Science', 'Employee shift'],
    ['EMP014', 'Gaurav Bansal', 'Assistant Professor', 'Computer Science', 'Employee shift'],
    ['EMP015', 'Isha Kapoor', 'Assistant Professor', 'Computer Science', 'Employee shift'],
    ['EMP016', 'Ritu Saxena', 'Assistant Professor', 'English', 'General shift'],
    ['EMP017', 'Manoj Tiwari', 'Assistant Professor', 'Mathematics', 'General shift'],
  ],
  classTeachers: ['EMP002', 'EMP012', 'EMP003'],
  roster: {
    codePrefix: 'STU2026', roll: (n) => `BCA24-${p3(n)}`, enroll: (n) => `ENR2024BCA${p3(n)}`, domain: 'student.horizon.example',
    phone: '+91 98123', dobYears: [2004, 2005], admitted: '2024-07-15', offset: 0,
    areas: ['Karve Nagar', 'Wakad', 'Pimpri', 'Kothrud', 'Baner', 'Hadapsar', 'Aundh', 'Viman Nagar', 'Hinjewadi', 'Kharadi'],
  },
  course: { code: 'BCA', name: 'BCA', fullName: 'Bachelor of Computer Applications', department: 'Computer Science', years: 3 },
  subjects: ['Python Programming', 'Data Structures', 'Database Management', 'Web Technologies', 'English Communication', 'Discrete Mathematics'],
  place: { room: 'Room 112-A3 - Main Block', lab: 'Computer Lab 2 - Block C' },
  students: [
    { code: 'STU2026001', roll: 'BCA24-001', enroll: 'ENR2024BCA001', name: 'Aarav Sharma', email: 'aarav.sharma@student.horizon.example', phone: '+91 98123 45601', dob: '2005-03-14', gender: 'Male', blood: 'B+', semester: 3, section: 'A', batch: '2024 - 2027', admitted: '2024-07-15', address: '#214, Karve Nagar, Pune, Maharashtra - 411052', guardian: { name: 'Rajesh Sharma', relation: 'Father', phone: '+91 98123 45600', email: 'rajesh.sharma@example.com' }, att: [[34, 38], [30, 36], [28, 34], [26, 32], [20, 22], [24, 30]] },
    { code: 'STU2026002', roll: 'BCA24-002', enroll: 'ENR2024BCA002', name: 'Simran Gill', email: 'simran.gill@student.horizon.example', phone: '+91 98123 45602', dob: '2005-08-02', gender: 'Female', blood: 'O+', semester: 3, section: 'A', batch: '2024 - 2027', admitted: '2024-07-15', address: '#12, Green Avenue, Wakad, Pune, Maharashtra - 411057', guardian: { name: 'Gurdeep Gill', relation: 'Father', phone: '+91 98123 45610', email: 'gurdeep.gill@example.com' }, att: [[36, 38], [33, 36], [31, 34], [30, 32], [21, 22], [27, 30]] },
    { code: 'STU2026003', roll: 'BCA24-003', enroll: 'ENR2024BCA003', name: 'Karan Mehta', email: 'karan.mehta@student.horizon.example', phone: '+91 98123 45603', dob: '2004-12-21', gender: 'Male', blood: 'A+', semester: 3, section: 'A', batch: '2024 - 2027', admitted: '2024-07-16', address: '#88, Sector 4, Pimpri, Pune, Maharashtra - 411018', guardian: { name: 'Anil Mehta', relation: 'Father', phone: '+91 98123 45620', email: 'anil.mehta@example.com' }, att: [[30, 38], [27, 36], [25, 34], [24, 32], [18, 22], [22, 30]] },
  ],
};

const school = {
  code: 'demo-school', name: 'Greenfield Public School', type: 'school', shortName: 'Greenfield',
  institute: {
    tagline: 'Nurturing young minds', email: 'office@greenfield.example', website: 'www.greenfield.example',
    address: '45 Park Street, Aundh', city: 'Pune', phone: '+91 20 4000 2000',
    details: {
      'Organisation Type': 'CBSE Affiliated School', 'Affiliation No.': 'CBSE/DEMO/2222', 'Registration No.': 'SAMPLE/0002',
      'Medium': 'English', 'Academic Session': session,
    },
    stakeholders: [
      { name: 'Mrs. Anita Deshmukh', role: 'Principal', email: 'principal@greenfield.example', phone: '+91 90000 55555' },
      { name: 'Mr. Vikram Joshi', role: 'Trust Chairman', email: 'chairman@greenfield.example', phone: '+91 90000 66666' },
    ],
    authorizedPersons: [
      { name: 'Mrs. Anita Deshmukh', designation: 'Principal', email: 'principal@greenfield.example', phone: '+91 90000 55555', pan: 'KLMNO****P', aadhaar: 'XXXX-XXXX-2468' },
    ],
    documents: [
      { name: 'CBSE Affiliation Certificate', issuedBy: 'CBSE', validTill: `${year + 3}-03-31`, status: 'Verified' },
      { name: 'Recognition Certificate', issuedBy: 'State Education Board', validTill: null, status: 'Verified' },
    ],
    beneficiaries: [
      { accountName: 'Greenfield Public School - Fees', bank: 'HDFC Bank', branch: 'Civil Lines', accountNumber: 'XXXXXX7710', ifsc: 'HDFC0000456', type: 'Current' },
    ],
    stamp: { stampText: 'GREENFIELD PUBLIC SCHOOL', stampSub: 'SINCE 2004', signatory: 'Mrs. Anita Deshmukh', signatoryTitle: 'Principal' },
  },
  admin: { loginId: 'ADM001', email: 'admin@greenfield.example', name: 'School Admin' },
  departments: [
    ['Science', 'Physics, Chemistry, Biology'], ['Languages', 'English, Hindi, Marathi'],
    ['Mathematics', 'Mathematics'], ['Administration', 'Office and support staff'],
  ],
  designations: [
    ['PGT', 'Science'], ['TGT', 'Science'], ['PGT', 'Languages'], ['TGT', 'Languages'], ['PGT', 'Mathematics'], ['Head Teacher', 'Languages'],
    ['TGT', 'Mathematics'],
  ],
  employees: [
    ['EMP001', 'Meera Kulkarni', 'PGT', 'Mathematics', 'General shift'],
    ['EMP002', 'Rahul Patil', 'PGT', 'Science', 'General shift'],
    ['EMP003', 'Sunita Rao', 'Head Teacher', 'Languages', 'General shift'],
    ['EMP004', 'Neha Bhatia', 'TGT', 'Languages', 'General shift'],
    ['EMP005', 'Imran Shaikh', 'TGT', 'Science', 'General shift'],
    ['EMP006', 'Pooja Nair', 'PGT', 'Languages', 'General shift'],
  ],
  moreEmployees: [
    ['EMP012', 'Anjali Deshpande', 'TGT', 'Mathematics', 'General shift'],
    ['EMP013', 'Sachin Gaikwad', 'TGT', 'Science', 'General shift'],
    ['EMP014', 'Farida Sayyed', 'TGT', 'Languages', 'General shift'],
    ['EMP015', 'Prakash Naik', 'TGT', 'Languages', 'General shift'],
    ['EMP016', 'Swati Jadhav', 'TGT', 'Science', 'General shift'],
    ['EMP017', 'Dinesh Kamble', 'TGT', 'Mathematics', 'General shift'],
  ],
  // Each class has a class teacher who takes the daily attendance in the first period
  classTeachers: ['EMP001', 'EMP012', 'EMP004'],
  roster: {
    codePrefix: 'GPS2026', roll: (n, d, k) => `9${d}-${p2(k)}`, enroll: (n) => `GPS/2026/${p4(n)}`, domain: 'student.greenfield.example',
    phone: '+91 98200', dobYears: [2010, 2011], admitted: `${year}-04-10`, offset: 17,
    areas: ['Aundh', 'Baner', 'Pashan', 'Kothrud', 'Wakad', 'Pimple Saudagar', 'Sus', 'Balewadi', 'Bavdhan', 'Warje'],
  },
  course: { code: 'CLASS9A', name: 'Class 9-A', fullName: 'Class 9, Section A', department: 'Science', years: 1 },
  subjects: ['Mathematics', 'Science', 'English', 'Hindi', 'Social Science', 'Computer Applications'],
  place: { room: 'Room 9A - Main Building', lab: 'Science Lab - Block B' },
  students: [
    { code: 'GPS2026001', roll: '9A-01', enroll: 'GPS/2026/0001', name: 'Ananya Kulkarni', email: 'ananya.k@student.greenfield.example', phone: '+91 98200 11001', dob: '2011-05-09', gender: 'Female', blood: 'A+', semester: 1, section: 'A', batch: session, admitted: `${year}-04-10`, address: 'Flat 4, Rosewood Apartments, Pune - 411045', guardian: { name: 'Sanjay Kulkarni', relation: 'Father', phone: '+91 98200 11000', email: 'sanjay.k@example.com' }, att: [[40, 44], [38, 44], [41, 44], [36, 40], [39, 44], [18, 20]] },
    { code: 'GPS2026002', roll: '9A-02', enroll: 'GPS/2026/0002', name: 'Rohan Desai', email: 'rohan.d@student.greenfield.example', phone: '+91 98200 11002', dob: '2011-01-22', gender: 'Male', blood: 'O+', semester: 1, section: 'A', batch: session, admitted: `${year}-04-10`, address: '12, Lake View Road, Pune - 411038', guardian: { name: 'Mahesh Desai', relation: 'Father', phone: '+91 98200 11010', email: 'mahesh.d@example.com' }, att: [[42, 44], [40, 44], [43, 44], [38, 40], [41, 44], [19, 20]] },
    { code: 'GPS2026003', roll: '9A-03', enroll: 'GPS/2026/0003', name: 'Zoya Khan', email: 'zoya.k@student.greenfield.example', phone: '+91 98200 11003', dob: '2010-11-30', gender: 'Female', blood: 'B+', semester: 1, section: 'A', batch: session, admitted: `${year}-04-11`, address: '7, Palm Grove, Pune - 411014', guardian: { name: 'Farhan Khan', relation: 'Father', phone: '+91 98200 11020', email: 'farhan.k@example.com' }, att: [[35, 44], [33, 44], [37, 44], [30, 40], [34, 44], [15, 20]] },
  ],
};

const university = {
  code: 'demo-university', name: 'MIT World Peace University, Pune', type: 'university', shortName: 'MIT-WPU',
  institute: {
    tagline: 'Knowledge is our fort', email: 'info@mitwpu.example', website: 'www.mitwpu.example',
    address: 'Paud Road, Kothrud', city: 'Pune', phone: '+91 20 4000 3000',
    details: {
      'Organisation Type': 'State Private University', 'Registration No.': 'SAMPLE/0004', 'UGC Status': 'Recognized',
      'Working Model': 'Offline', 'Academic Session': session,
    },
    stakeholders: [
      { name: 'Prof. Vishwanath Karad', role: 'Vice-Chancellor', email: 'vc@mitwpu.example', phone: '+91 90000 99999' },
      { name: 'Dr. Sanjyot Deshpande', role: 'Registrar', email: 'registrar@mitwpu.example', phone: '+91 90000 88888' },
      { name: 'Dr. Prasad Khandekar', role: 'Dean, School of CSE', email: 'dean.cse@mitwpu.example', phone: '+91 90000 77777' },
    ],
    authorizedPersons: [
      { name: 'Dr. Sanjyot Deshpande', designation: 'Registrar', email: 'registrar@mitwpu.example', phone: '+91 90000 88888', pan: 'MNOPQ****R', aadhaar: 'XXXX-XXXX-3690' },
      { name: 'Dr. Prasad Khandekar', designation: 'Dean, School of CSE', email: 'dean.cse@mitwpu.example', phone: '+91 90000 77777', pan: 'STUVW****X', aadhaar: 'XXXX-XXXX-1470' },
    ],
    documents: [
      { name: 'UGC Recognition Certificate', issuedBy: 'University Grants Commission', validTill: null, status: 'Verified' },
      { name: 'NAAC Accreditation', issuedBy: 'NAAC', validTill: `${year + 2}-03-31`, status: 'Verified' },
      { name: 'State Government Gazette Notification', issuedBy: 'Government of Maharashtra', validTill: null, status: 'Verified' },
    ],
    beneficiaries: [
      { accountName: 'MIT World Peace University - Fee Collection', bank: 'Bank of Maharashtra', branch: 'Kothrud Branch', accountNumber: 'XXXXXX9042', ifsc: 'MAHB0001122', type: 'Current' },
    ],
    stamp: { stampText: 'MIT WORLD PEACE UNIVERSITY', stampSub: 'PUNE, MAHARASHTRA', signatory: 'Dr. Sanjyot Deshpande', signatoryTitle: 'Registrar' },
  },
  admin: { loginId: 'ADM001', email: 'admin@mitwpu.example', name: 'University Admin' },
  departments: [
    ['School of Computer Science & Engineering', 'CSE, AI & Data Science, and allied programmes'],
    ['School of Design', 'Design and creative programmes'],
    ['School of Management', 'Business and management programmes'],
    ['Administration', 'Administrative and support staff'],
  ],
  designations: [
    ['Professor', 'School of Computer Science & Engineering'], ['Associate Professor', 'School of Computer Science & Engineering'],
    ['Assistant Professor', 'School of Computer Science & Engineering'], ['Dean', 'School of Design'],
    ['Associate Professor', 'School of Management'], ['Assistant Professor', 'School of Design'], ['Assistant Professor', 'School of Management'],
  ],
  employees: [
    ['EMP001', 'Prasad Khandekar', 'Professor', 'School of Computer Science & Engineering', 'Employee shift'],
    ['EMP002', 'Aditi Kulkarni', 'Associate Professor', 'School of Computer Science & Engineering', 'Employee shift'],
    ['EMP003', 'Rahul Deshmukh', 'Assistant Professor', 'School of Computer Science & Engineering', 'Employee shift'],
    ['EMP004', 'Neha Joshi', 'Assistant Professor', 'School of Computer Science & Engineering', 'Employee shift'],
    ['EMP005', 'Omkar Patwardhan', 'Dean', 'School of Design', 'General shift'],
    ['EMP006', 'Shalini Rao', 'Associate Professor', 'School of Management', 'General shift'],
  ],
  moreEmployees: [
    ['EMP012', 'Meenal Phadke', 'Associate Professor', 'School of Computer Science & Engineering', 'Employee shift'],
    ['EMP013', 'Sandeep Gokhale', 'Assistant Professor', 'School of Computer Science & Engineering', 'Employee shift'],
    ['EMP014', 'Tanvi Bhosale', 'Assistant Professor', 'School of Computer Science & Engineering', 'Employee shift'],
    ['EMP015', 'Akash Mane', 'Assistant Professor', 'School of Computer Science & Engineering', 'Employee shift'],
    ['EMP016', 'Kiran Lele', 'Assistant Professor', 'School of Computer Science & Engineering', 'Employee shift'],
    ['EMP017', 'Sneha Apte', 'Assistant Professor', 'School of Management', 'General shift'],
  ],
  classTeachers: ['EMP003', 'EMP013', 'EMP004'],
  roster: {
    codePrefix: 'MIT2026', roll: (n) => `CSAI24-${p3(n)}`, enroll: (n) => `ENR2024CSAI${p3(n)}`, domain: 'student.mitwpu.example',
    phone: '+91 98220', dobYears: [2004, 2005], admitted: '2024-07-20', offset: 41,
    areas: ['Kothrud', 'Baner', 'Hinjewadi', 'Warje', 'Karve Nagar', 'Bavdhan', 'Aundh', 'Pashan', 'Erandwane', 'Sinhagad Road'],
  },
  course: { code: 'BTCSAI', name: 'B.Tech CSE (AI & DS)', fullName: 'B.Tech Computer Science Engineering (AI & Data Science)', department: 'School of Computer Science & Engineering', years: 4 },
  subjects: ['Machine Learning', 'Data Structures & Algorithms', 'Deep Learning', 'Database Management', 'Computer Networks', 'Professional Communication'],
  place: { room: 'Room 304 - Academic Block 2', lab: 'AI & DS Lab - Block 2' },
  students: [
    { code: 'MIT2026001', roll: 'CSAI24-001', enroll: 'ENR2024CSAI001', name: 'Aditya Kulkarni', email: 'aditya.kulkarni@student.mitwpu.example', phone: '+91 98220 11001', dob: '2005-02-18', gender: 'Male', blood: 'B+', semester: 5, section: 'A', batch: '2024 - 2028', admitted: '2024-07-20', address: '#45, Kothrud, Pune, Maharashtra - 411038', guardian: { name: 'Suresh Kulkarni', relation: 'Father', phone: '+91 98220 11000', email: 'suresh.kulkarni@example.com' }, att: [[34, 38], [30, 36], [28, 34], [26, 32], [20, 22], [24, 30]] },
    { code: 'MIT2026002', roll: 'CSAI24-002', enroll: 'ENR2024CSAI002', name: 'Sanika Deshpande', email: 'sanika.deshpande@student.mitwpu.example', phone: '+91 98220 11002', dob: '2005-06-09', gender: 'Female', blood: 'O+', semester: 5, section: 'A', batch: '2024 - 2028', admitted: '2024-07-20', address: '#12, Baner, Pune, Maharashtra - 411045', guardian: { name: 'Vivek Deshpande', relation: 'Father', phone: '+91 98220 11010', email: 'vivek.deshpande@example.com' }, att: [[36, 38], [33, 36], [31, 34], [30, 32], [21, 22], [27, 30]] },
    { code: 'MIT2026003', roll: 'CSAI24-003', enroll: 'ENR2024CSAI003', name: 'Rohan Patil', email: 'rohan.patil@student.mitwpu.example', phone: '+91 98220 11003', dob: '2004-11-27', gender: 'Male', blood: 'A+', semester: 5, section: 'A', batch: '2024 - 2028', admitted: '2024-07-21', address: '#77, Hinjewadi, Pune, Maharashtra - 411057', guardian: { name: 'Mahesh Patil', relation: 'Father', phone: '+91 98220 11020', email: 'mahesh.patil@example.com' }, att: [[30, 38], [27, 36], [25, 34], [24, 32], [18, 22], [22, 30]] },
  ],
};

export const DEMO_TENANTS = [college, school, university];

/* ------------------------------------------------------------------------------------------------------------------
 * The classes and students. Every institute has three divisions of 40 students. A division is its own class (course):
 * its own roster, timetable, fee plan, exams and attendance. The three students listed in each spec above are the
 * first three of division A, so the well-known demo logins (STU2026001, GPS2026001, MIT2026001) still work.
 * ------------------------------------------------------------------------------------------------------------------ */
export const DIVISIONS = ['A', 'B', 'C'];
export const PER_DIVISION = 40;

const MALE = ['Aarav', 'Vihaan', 'Arjun', 'Reyansh', 'Ishaan', 'Kabir', 'Advait', 'Atharv', 'Dhruv', 'Yash', 'Rohan', 'Karan', 'Siddharth', 'Pranav', 'Tejas', 'Omkar', 'Harsh', 'Nikhil', 'Varun', 'Shreyas', 'Aditya', 'Rahul', 'Sahil', 'Mayur', 'Amit', 'Rishi', 'Neel', 'Parth', 'Chirag', 'Gaurav', 'Manav', 'Soham', 'Aniket', 'Vedant', 'Hrithik', 'Kunal', 'Sanket', 'Prathamesh', 'Ayush', 'Jayesh'];
const FEMALE = ['Ananya', 'Diya', 'Saanvi', 'Aadhya', 'Myra', 'Kiara', 'Anika', 'Ira', 'Navya', 'Pari', 'Riya', 'Sneha', 'Pooja', 'Kavya', 'Tanvi', 'Shruti', 'Isha', 'Meera', 'Neha', 'Priya', 'Sanika', 'Simran', 'Aditi', 'Gauri', 'Mansi', 'Radhika', 'Sakshi', 'Trisha', 'Vaishnavi', 'Zoya', 'Aarohi', 'Bhavya', 'Disha', 'Janhvi', 'Khushi', 'Manasi', 'Nidhi', 'Prachi', 'Rutuja', 'Swara'];
const SURNAMES = ['Sharma', 'Patil', 'Kulkarni', 'Deshmukh', 'Joshi', 'Gupta', 'Mehta', 'Singh', 'Gill', 'Verma', 'Kapoor', 'Nair', 'Iyer', 'Rao', 'Khan', 'Shaikh', 'Pawar', 'Jadhav', 'More', 'Shinde', 'Bhosale', 'Chavan', 'Gaikwad', 'Kamble', 'Naik', 'Desai', 'Bhatia', 'Malhotra', 'Saxena', 'Tiwari', 'Agarwal', 'Menon', 'Pillai', 'Thakur', 'Mishra'];
const BLOOD = ['O+', 'B+', 'A+', 'O+', 'B+', 'A+', 'AB+', 'O-', 'A-', 'B-'];

/** A fixed number in [0, 1) from a string, so the sample students are the same every time. */
const unit = (key) => crypto.createHash('md5').update(key).digest().readUInt32BE(0) / 2 ** 32;

/** The class (course) for one division: Class 9-B, BCA - Division B, ... */
export function divisionCourse(spec, division) {
  const c = spec.course;
  if (spec.type === 'school') return { code: `CLASS9${division}`, name: `Class 9-${division}`, fullName: `Class 9, Section ${division}`, department: c.department, years: c.years };
  return { code: `${c.code}-${division}`, name: `${c.name} - Division ${division}`, fullName: `${c.fullName} (Division ${division})`, department: c.department, years: c.years };
}

/** All students of an institute (3 divisions x 40): the named ones first, then generated ones. Each has `section` = its division. */
export function rosterFor(spec) {
  const r = spec.roster;
  const totals = spec.students[0].att.map(([, total]) => total);
  const used = new Set(spec.students.map((s) => s.name.toLowerCase()));
  const emails = new Set(spec.students.map((s) => s.email.toLowerCase()));
  const out = [];
  const total = DIVISIONS.length * PER_DIVISION;
  for (let n = 1; n <= total; n += 1) {
    const division = DIVISIONS[Math.floor((n - 1) / PER_DIVISION)];
    const k = ((n - 1) % PER_DIVISION) + 1;
    const named = spec.students[n - 1];
    if (named) { out.push({ ...named, section: division }); continue; }
    const code = `${r.codePrefix}${p3(n)}`;
    const female = unit(`g|${spec.code}|${n}`) < 0.48;
    const pool = female ? FEMALE : MALE;
    const first = pool[(n * 7 + r.offset) % pool.length];
    let li = (n * 11 + r.offset * 3) % SURNAMES.length;
    let name = `${first} ${SURNAMES[li]}`;
    while (used.has(name.toLowerCase())) { li = (li + 1) % SURNAMES.length; name = `${first} ${SURNAMES[li]}`; }
    used.add(name.toLowerCase());
    let email = `${first}.${SURNAMES[li]}@${r.domain}`.toLowerCase();
    if (emails.has(email)) email = `${first}.${SURNAMES[li]}${n}@${r.domain}`.toLowerCase();
    emails.add(email);
    const dad = MALE[(n * 5 + r.offset + 3) % MALE.length];
    const dobYear = r.dobYears[0] + Math.floor(unit(`y|${code}`) * (r.dobYears[1] - r.dobYears[0] + 1));
    // Roughly seven in ten students attend well, some are borderline, and a few are below the 75% minimum
    const u = unit(`a|${code}`); const v = unit(`b|${code}`);
    const rate = u < 0.14 ? 0.58 + 0.14 * v : u < 0.3 ? 0.72 + 0.07 * v : 0.82 + 0.15 * v;
    out.push({
      code, roll: r.roll(n, division, k), enroll: r.enroll(n), name, email,
      phone: `${r.phone} ${String(10000 + n * 37).slice(-5)}`,
      dob: `${dobYear}-${p2(1 + Math.floor(unit(`m|${code}`) * 12))}-${p2(1 + Math.floor(unit(`d|${code}`) * 28))}`,
      gender: female ? 'Female' : 'Male', blood: BLOOD[n % BLOOD.length],
      semester: spec.students[0].semester, section: division, batch: spec.students[0].batch, admitted: r.admitted,
      address: `#${10 + ((n * 13) % 190)}, ${r.areas[n % r.areas.length]}, Pune, Maharashtra - 4110${p2(10 + (n % 60))}`,
      guardian: { name: `${dad} ${SURNAMES[li]}`, relation: 'Father', phone: `${r.phone} ${String(20000 + n * 53).slice(-5)}`, email: `${dad}.${SURNAMES[li]}${n}@example.com`.toLowerCase() },
      att: totals.map((t, i) => [Math.round(t * Math.min(1, rate * (0.96 + 0.08 * unit(`s${i}|${code}`)))), t]),
    });
  }
  return out;
}

export const DEMO_PASSWORDS = { admin: 'Admin@123', student: 'Student@123', parent: 'Parent@123', employee: 'Employee@123', super_admin: 'SuperAdmin@123' };
