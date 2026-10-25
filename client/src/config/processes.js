// The seven processes and their steps, in one place, so a step is called the same thing on every
// screen, in the help guide and in the tests. A screen shows its process with
//   <StepBar process="fees" current="collect" />
// Keys never change (screens and saved progress use them); labels may be reworded here only.

const steps = (...list) => list.map(([key, label]) => ({ key, label }));

export const PROCESSES = {
  setup: {
    title: 'Institute setup',
    steps: steps(
      ['profile', 'Profile and logo'],
      ['year', 'Academic year'],
      ['classes', 'Classes and divisions'],
      ['subjects', 'Subjects and faculty'],
      ['fees', 'Fee heads and plans'],
      ['import', 'Import students and staff'],
      ['invite', 'Invite people'],
    ),
  },
  admissions: {
    title: 'Admissions',
    steps: steps(
      ['enquiry', 'Enquiry'],
      ['application', 'Application'],
      ['documents', 'Documents checked'],
      ['decision', 'Decision'],
      ['offer', 'Offer'],
      ['fee', 'Enrolment fee'],
      ['enrolled', 'Enrolled'],
    ),
  },
  fees: {
    title: 'Fee cycle',
    steps: steps(
      ['setup', 'Set up fees'],
      ['assign', 'Assign to class'],
      ['dues', 'Dues generated'],
      ['remind', 'Remind'],
      ['collect', 'Collect'],
      ['receipt', 'Receipt'],
      ['dayend', 'Day-end summary'],
    ),
  },
  attendanceSchool: {
    title: 'Daily attendance',
    steps: steps(
      ['open', 'Open register'],
      ['mark', 'Mark'],
      ['submit', 'Submit'],
    ),
  },
  attendanceCollege: {
    title: 'Daily attendance',
    steps: steps(
      ['lectures', "Today's lectures"],
      ['mark', 'Mark or QR'],
      ['review', 'Review'],
      ['submit', 'Submit'],
    ),
  },
  exams: {
    title: 'Exams and results',
    steps: steps(
      ['create', 'Create exam'],
      ['papers', 'Papers and dates'],
      ['marks', 'Marks entered'],
      ['checked', 'Checked'],
      ['published', 'Published'],
      ['reports', 'Report cards'],
    ),
  },
  family: {
    title: 'Parent and student',
    steps: steps(
      ['invite', 'Invite'],
      ['signin', 'First sign-in and consent'],
      ['today', 'My day'],
      ['pay', 'Pay'],
      ['notices', 'Notices'],
    ),
  },
  onboarding: {
    title: 'Client onboarding',
    steps: steps(
      ['create', 'Create institute'],
      ['modules', 'Pick type and modules'],
      ['invite', 'Send admin invite'],
      ['progress', 'Watch setup progress'],
      ['checkin', '30/60/90-day check'],
    ),
  },
};

/** Daily attendance has a college form (lectures and QR, as CHECKIN_TYPES) and a register form for everyone else. */
export const attendanceProcess = (tenantType) => (['college', 'university'].includes(tenantType) ? 'attendanceCollege' : 'attendanceSchool');

/** The steps of a process, or [] for an unknown name (so a typo shows nothing rather than crashing a page). */
export const processSteps = (id) => PROCESSES[id]?.steps || [];
